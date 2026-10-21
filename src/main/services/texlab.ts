import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

/** JSON values accepted by the Language Server Protocol. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface TexlabStartOptions {
  /** Absolute path to a bundled or explicitly configured TexLab executable. */
  executable: string;
  /** Absolute root of the selected project. A project change restarts TexLab. */
  workspaceRoot: string;
  /** Optional TexLab settings, supplied only by trusted main-process configuration. */
  initializationOptions?: JsonObject;
}

export interface TexlabServerInfo {
  name?: string;
  version?: string;
}

export interface TexlabInitializeResult {
  capabilities: JsonObject;
  serverInfo?: TexlabServerInfo;
}

/** Safe runtime state for Settings and health checks; it does not expose the executable path. */
export interface TexlabRuntimeStatus {
  running: boolean;
  serverInfo?: TexlabServerInfo;
}

export interface TexlabTextDocument {
  /** Canonical absolute filesystem path. It is converted to a file URI by this service. */
  path: string;
  text: string;
  /** Monaco's monotonically increasing model version, when available. */
  version?: number;
  languageId?: string;
}

export interface TexlabDocumentChange {
  path: string;
  text: string;
  /** Monaco's monotonically increasing model version, when available. */
  version?: number;
}

export interface TexlabServiceOptions {
  /** Receives server-published notifications such as textDocument/publishDiagnostics. */
  onNotification?: (method: string, params: JsonValue | undefined) => void;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: JsonValue) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout | null;
  method: string;
  params?: JsonValue;
  lane: string | null;
  signature: string;
  sent: boolean;
  promise: Promise<JsonValue>;
}

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

export class TexlabError extends Error {
  constructor(
    readonly code:
      | 'TEXLAB_NOT_STARTED'
      | 'TEXLAB_START_FAILED'
      | 'TEXLAB_PROTOCOL_ERROR'
      | 'TEXLAB_REQUEST_FAILED'
      | 'TEXLAB_BUSY'
      | 'TEXLAB_REQUEST_TIMEOUT',
    message: string,
  ) {
    super(message);
    this.name = 'TexlabError';
  }
}

const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
const STOP_TIMEOUT_MS = 2_000;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_ACTIVE_REQUESTS = 8;
const MAX_PENDING_REQUESTS = 64;

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value).every(isJsonValue);
}

function asJsonObject(value: unknown): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || !isJsonValue(value))
    throw new TexlabError('TEXLAB_PROTOCOL_ERROR', 'TexLab returned an invalid JSON-RPC response.');
  return value as JsonObject;
}

function documentUri(path: string): string {
  if (!isAbsolute(path))
    throw new TexlabError('TEXLAB_PROTOCOL_ERROR', 'TexLab needs an absolute document path.');
  return pathToFileURL(path).href;
}

/**
 * Owns one TexLab subprocess and speaks LSP JSON-RPC over its stdio streams.
 *
 * The service deliberately accepts only absolute paths and full-text document changes. It does
 * not know about Electron IPC, renderer state, or project path authorization; callers must
 * validate those boundaries before invoking it.
 */
export class TexlabService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private initialized = false;
  private workspaceRoot: string | null = null;
  private nextRequestId = 1;
  private receiveBuffer = Buffer.alloc(0);
  private readonly pending = new Map<number, PendingRequest>();
  private readonly documentVersions = new Map<string, number>();
  private readonly documentTexts = new Map<string, string>();
  private starting: Promise<TexlabInitializeResult> | null = null;

  constructor(private readonly options: TexlabServiceOptions = {}) {}

  get running(): boolean {
    return this.child !== null && this.initialized;
  }

  get status(): TexlabRuntimeStatus {
    return this.initializeResult.serverInfo
      ? { running: this.running, serverInfo: this.initializeResult.serverInfo }
      : { running: this.running };
  }

  async start(options: TexlabStartOptions): Promise<TexlabInitializeResult> {
    if (!options.executable || !options.workspaceRoot)
      throw new TexlabError(
        'TEXLAB_START_FAILED',
        'TexLab needs a configured executable and workspace.',
      );
    if (this.running && this.workspaceRoot === options.workspaceRoot) return this.initializeResult;
    if (this.running) await this.stop();
    if (this.starting) {
      await this.starting;
      return this.start(options);
    }

    this.starting = this.spawnAndInitialize(options).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private initializeResult: TexlabInitializeResult = { capabilities: {} };

  private async spawnAndInitialize(options: TexlabStartOptions): Promise<TexlabInitializeResult> {
    const child = await new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
      const process = spawn(options.executable, [], {
        cwd: options.workspaceRoot,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const fail = (error: Error) => {
        process.removeListener('spawn', succeed);
        reject(new TexlabError('TEXLAB_START_FAILED', `TexLab could not start: ${error.message}`));
      };
      const succeed = () => {
        process.removeListener('error', fail);
        resolve(process);
      };
      process.once('error', fail);
      process.once('spawn', succeed);
    });
    this.attach(child);
    this.workspaceRoot = options.workspaceRoot;
    try {
      const result = asJsonObject(
        await this.requestInternal('initialize', {
          processId: process.pid,
          rootUri: documentUri(options.workspaceRoot),
          workspaceFolders: [{ uri: documentUri(options.workspaceRoot), name: 'TeXtra project' }],
          capabilities: {
            workspace: { workspaceFolders: true },
            textDocument: {
              completion: { completionItem: { snippetSupport: true } },
              publishDiagnostics: { relatedInformation: true },
            },
          },
          ...(options.initializationOptions
            ? { initializationOptions: options.initializationOptions }
            : {}),
        }),
      );
      const capabilities = asJsonObject(result.capabilities ?? {});
      const serverInfo = this.parseServerInfo(result.serverInfo);
      this.initializeResult = serverInfo ? { capabilities, serverInfo } : { capabilities };
      this.initialized = true;
      this.notifyInternal('initialized', {});
      return this.initializeResult;
    } catch (error) {
      await this.stopImmediately();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    for (const [id, request] of this.pending) if (request.lane) this.cancelRequest(id);
    try {
      if (this.initialized) await this.requestInternal('shutdown', null);
      this.notifyInternal('exit');
    } catch {
      // A terminating language server does not need to complete graceful shutdown.
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!child.killed) child.kill();
        resolve();
      }, STOP_TIMEOUT_MS);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.clearState('TexLab stopped.');
  }

  async openDocument(document: TexlabTextDocument): Promise<void> {
    this.requireStarted();
    this.validateDocumentText(document.text);
    const uri = documentUri(document.path);
    const version = this.documentVersions.get(uri);
    if (version !== undefined) {
      await this.changeDocument(document);
      return;
    }
    const documentVersion = this.validDocumentVersion(document.version) ?? 1;
    this.documentVersions.set(uri, documentVersion);
    this.documentTexts.set(uri, document.text);
    this.notifyInternal('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: document.languageId ?? 'latex',
        version: documentVersion,
        text: document.text,
      },
    });
  }

  async changeDocument(change: TexlabDocumentChange): Promise<void> {
    this.requireStarted();
    this.validateDocumentText(change.text);
    const uri = documentUri(change.path);
    const previous = this.documentVersions.get(uri);
    if (previous === undefined) {
      await this.openDocument({ path: change.path, text: change.text, version: change.version });
      return;
    }
    const requestedVersion = this.validDocumentVersion(change.version);
    // Repeated syncs are common across Monaco providers. Re-publishing identical
    // source invalidates TexLab work and can create a diagnostics/render loop.
    if (this.documentTexts.get(uri) === change.text) return;
    if (requestedVersion !== undefined && requestedVersion <= previous) return;
    const version =
      requestedVersion && requestedVersion > previous ? requestedVersion : previous + 1;
    this.documentVersions.set(uri, version);
    this.documentTexts.set(uri, change.text);
    this.cancelDocumentRequests(uri);
    this.notifyInternal('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text: change.text }],
    });
  }

  /** A delayed editor request cannot navigate against a newer source snapshot. */
  matchesDocument(path: string, text: string): boolean {
    return this.documentTexts.get(documentUri(path)) === text;
  }

  closeDocument(path: string): void {
    if (!this.running) return;
    const uri = documentUri(path);
    if (!this.documentVersions.delete(uri)) return;
    this.documentTexts.delete(uri);
    this.cancelDocumentRequests(uri);
    this.notifyInternal('textDocument/didClose', { textDocument: { uri } });
  }

  /** Send any supported LSP request after document synchronization has occurred. */
  async request(method: string, params?: JsonValue): Promise<JsonValue> {
    this.requireStarted();
    return this.requestInternal(method, params);
  }

  /** Send an LSP notification after document synchronization has occurred. */
  notify(method: string, params?: JsonValue): void {
    this.requireStarted();
    this.notifyInternal(method, params);
  }

  async completion(path: string, line: number, character: number): Promise<JsonValue> {
    return this.requestAtPosition('textDocument/completion', path, line, character);
  }

  async hover(path: string, line: number, character: number): Promise<JsonValue> {
    return this.requestAtPosition('textDocument/hover', path, line, character);
  }

  async definition(path: string, line: number, character: number): Promise<JsonValue> {
    return this.requestAtPosition('textDocument/definition', path, line, character);
  }

  async references(path: string, line: number, character: number): Promise<JsonValue> {
    return this.requestAtPosition('textDocument/references', path, line, character, {
      context: { includeDeclaration: true },
    });
  }

  async documentSymbols(path: string): Promise<JsonValue> {
    this.requireStarted();
    return this.requestInternal('textDocument/documentSymbol', {
      textDocument: { uri: documentUri(path) },
    });
  }

  async foldingRanges(path: string): Promise<JsonValue> {
    this.requireStarted();
    return this.requestInternal('textDocument/foldingRange', {
      textDocument: { uri: documentUri(path) },
    });
  }

  private requestAtPosition(
    method: string,
    path: string,
    line: number,
    character: number,
    extra: JsonObject = {},
  ): Promise<JsonValue> {
    this.requireStarted();
    if (!Number.isInteger(line) || line < 0 || !Number.isInteger(character) || character < 0)
      throw new TexlabError(
        'TEXLAB_PROTOCOL_ERROR',
        'TexLab positions must be zero-based integers.',
      );
    return this.requestInternal(method, {
      textDocument: { uri: documentUri(path) },
      position: { line, character },
      ...extra,
    });
  }

  private attach(child: ChildProcessWithoutNullStreams): void {
    this.child = child;
    child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    child.stderr.on('data', () => {
      // TexLab writes human-readable progress to stderr; it is not an LSP channel.
    });
    const stopped = () => {
      if (this.child === child) this.clearState('TexLab stopped unexpectedly.');
    };
    child.once('error', stopped);
    child.once('close', stopped);
  }

  private receive(chunk: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
    while (true) {
      const headerEnd = this.receiveBuffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.receiveBuffer.subarray(0, headerEnd).toString('ascii');
      const contentLengthRow = header.split('\r\n').find((row) => /^content-length\s*:/i.test(row));
      const contentLength = Number(contentLengthRow?.split(':', 2)[1]?.trim());
      if (
        !Number.isSafeInteger(contentLength) ||
        contentLength < 0 ||
        contentLength > MAX_MESSAGE_BYTES
      ) {
        void this.stopImmediately();
        return;
      }
      const messageEnd = headerEnd + 4 + contentLength;
      if (this.receiveBuffer.length < messageEnd) return;
      const body = this.receiveBuffer.subarray(headerEnd + 4, messageEnd).toString('utf8');
      this.receiveBuffer = this.receiveBuffer.subarray(messageEnd);
      try {
        this.handleMessage(JSON.parse(body) as JsonRpcMessage);
      } catch {
        void this.stopImmediately();
        return;
      }
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (message.jsonrpc !== '2.0')
      throw new TexlabError('TEXLAB_PROTOCOL_ERROR', 'Invalid JSON-RPC version.');
    if (typeof message.id === 'number' && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if ('error' in message && message.error !== undefined) {
        pending.reject(new TexlabError('TEXLAB_REQUEST_FAILED', this.errorMessage(message.error)));
      } else if (isJsonValue(message.result)) {
        pending.resolve(message.result);
      } else {
        pending.reject(
          new TexlabError('TEXLAB_PROTOCOL_ERROR', 'TexLab returned invalid request data.'),
        );
      }
      this.dispatchPending();
      return;
    }
    if (typeof message.method === 'string') {
      this.options.onNotification?.(
        message.method,
        isJsonValue(message.params) ? message.params : undefined,
      );
      if (message.id !== undefined) this.respondMethodNotFound(message.id);
    }
  }

  private requestInternal(method: string, params?: JsonValue): Promise<JsonValue> {
    const document =
      params && !Array.isArray(params) && typeof params === 'object'
        ? params.textDocument
        : undefined;
    const uri =
      document &&
      !Array.isArray(document) &&
      typeof document === 'object' &&
      typeof document.uri === 'string'
        ? document.uri
        : null;
    const lane = uri && method.startsWith('textDocument/') ? `${uri}\0${method}` : null;
    const signature = JSON.stringify([params, uri ? this.documentVersions.get(uri) : null]);
    if (lane) {
      for (const [previousId, previous] of this.pending) {
        if (previous.lane !== lane) continue;
        if (previous.signature === signature) return previous.promise;
        // The newer cursor/document snapshot supersedes older background work.
        this.cancelRequest(previousId);
      }
    }
    if (this.pending.size >= MAX_PENDING_REQUESTS)
      return Promise.reject(
        new TexlabError('TEXLAB_BUSY', 'TexLab has too many pending requests.'),
      );
    const id = this.nextRequestId++;
    let resolve!: (value: JsonValue) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<JsonValue>((success, failure) => {
      resolve = success;
      reject = failure;
    });
    const pending: PendingRequest = {
      resolve,
      reject,
      promise,
      method,
      params,
      lane,
      signature,
      sent: false,
      timer: null,
    };
    pending.timer = setTimeout(() => {
      if (!this.pending.delete(id)) return;
      if (pending.sent) this.cancelOnServer(id);
      pending.reject(
        new TexlabError('TEXLAB_REQUEST_TIMEOUT', `TexLab did not respond to ${method}.`),
      );
      this.dispatchPending();
    }, this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    this.pending.set(id, pending);
    this.dispatchPending();
    return promise;
  }

  private dispatchPending(): void {
    let active = [...this.pending.values()].filter((request) => request.sent).length;
    for (const [id, request] of this.pending) {
      if (request.sent) continue;
      if (active >= MAX_ACTIVE_REQUESTS && request.lane) continue;
      request.sent = true;
      active++;
      try {
        this.write({
          jsonrpc: '2.0',
          id,
          method: request.method,
          ...(request.params === undefined ? {} : { params: request.params }),
        });
      } catch (error) {
        if (request.timer) clearTimeout(request.timer);
        this.pending.delete(id);
        request.reject(error instanceof Error ? error : new Error('TexLab request failed.'));
        active--;
      }
    }
  }

  private cancelOnServer(id: number): void {
    try {
      this.notifyInternal('$/cancelRequest', { id });
    } catch {
      /* Server already stopped. */
    }
  }

  private cancelRequest(id: number): void {
    const request = this.pending.get(id);
    if (!request) return;
    this.pending.delete(id);
    if (request.timer) clearTimeout(request.timer);
    if (request.sent) this.cancelOnServer(id);
    // Superseded editor work is normal cancellation, not a failed user action.
    request.resolve(null);
  }

  private cancelDocumentRequests(uri: string): void {
    for (const [id, request] of this.pending)
      if (request.lane?.startsWith(`${uri}\0`)) this.cancelRequest(id);
    this.dispatchPending();
  }

  private notifyInternal(method: string, params?: JsonValue): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  private respondMethodNotFound(id: unknown): void {
    if (typeof id !== 'number' && typeof id !== 'string') return;
    this.write({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: 'Client does not handle server requests.' },
    });
  }

  private write(message: JsonObject): void {
    const child = this.child;
    if (!child || child.stdin.destroyed)
      throw new TexlabError('TEXLAB_NOT_STARTED', 'TexLab is not running.');
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    child.stdin.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
    child.stdin.write(body);
  }

  private parseServerInfo(value: unknown): TexlabServerInfo | undefined {
    if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined;
    const candidate = value as { name?: unknown; version?: unknown };
    if (typeof candidate.name !== 'string') return undefined;
    return typeof candidate.version === 'string'
      ? { name: candidate.name, version: candidate.version }
      : { name: candidate.name };
  }

  private errorMessage(value: unknown): string {
    if (
      value &&
      typeof value === 'object' &&
      'message' in value &&
      typeof value.message === 'string'
    )
      return value.message;
    return 'TexLab rejected the request.';
  }

  private requireStarted(): void {
    if (!this.running) throw new TexlabError('TEXLAB_NOT_STARTED', 'TexLab is not running.');
  }

  private validDocumentVersion(value: number | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isSafeInteger(value) || value < 1)
      throw new TexlabError(
        'TEXLAB_PROTOCOL_ERROR',
        'TexLab document versions must be positive integers.',
      );
    return value;
  }

  private validateDocumentText(value: string): void {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_DOCUMENT_BYTES)
      throw new TexlabError('TEXLAB_PROTOCOL_ERROR', 'The document is too large for TexLab.');
  }

  private async stopImmediately(): Promise<void> {
    const child = this.child;
    if (child && !child.killed) child.kill();
    this.clearState('TexLab stopped unexpectedly.');
  }

  private clearState(reason: string): void {
    const error = new TexlabError('TEXLAB_NOT_STARTED', reason);
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.child = null;
    this.initialized = false;
    this.workspaceRoot = null;
    this.receiveBuffer = Buffer.alloc(0);
    this.documentVersions.clear();
    this.documentTexts.clear();
  }
}
