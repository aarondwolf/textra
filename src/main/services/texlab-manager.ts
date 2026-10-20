import { execFile } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { delimiter, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type {
  Diagnostic,
  FileRef,
  TexlabDocumentRequest,
  TexlabRequest,
  TexlabStatus,
} from '../../shared/api';
import { ProjectError, ProjectService } from './projects';
import { TexlabError, TexlabService, type JsonValue } from './texlab';

const execFileAsync = promisify(execFile);
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_DIAGNOSTICS = 500;

interface LspRange {
  start?: { line?: unknown; character?: unknown };
}
interface LspDiagnostic {
  range?: LspRange;
  severity?: unknown;
  message?: unknown;
  code?: unknown;
  source?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function texlabPlatformDirectory(): string {
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const architecture = process.arch === 'x64' ? 'x64' : process.arch;
  return `${platform}-${architecture}`;
}

async function executableOnPath(): Promise<string | null> {
  const executable = process.platform === 'win32' ? 'texlab.exe' : 'texlab';
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry) continue;
    const candidate = join(entry, executable);
    try {
      await access(candidate);
      return await realpath(candidate);
    } catch {
      // Continue through the user's PATH. No shell lookup is used.
    }
  }
  return null;
}

function parseVersion(output: string): string | null {
  const match = /(?:texlab\s+)?v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/i.exec(output);
  return match?.[1] ?? null;
}

/**
 * Bridges TeXtra's project-authorized files to one independently running TexLab process.
 * The manager starts only after an editor request and never exposes arbitrary LSP methods.
 */
export class TexlabManager {
  private readonly service: TexlabService;
  private readonly diagnostics = new Map<string, Diagnostic[]>();
  private currentProjectId: string | null = null;

  constructor(
    private readonly projects: ProjectService,
    private readonly resourceDirectory: string,
    private readonly enabled: () => Promise<boolean>,
  ) {
    this.service = new TexlabService({
      onNotification: (method, params) => {
        if (method === 'textDocument/publishDiagnostics') this.receiveDiagnostics(params);
      },
    });
  }

  private managedExecutable(): string {
    return join(
      this.resourceDirectory,
      'texlab',
      texlabPlatformDirectory(),
      process.platform === 'win32' ? 'texlab.exe' : 'texlab',
    );
  }

  private async resolveInstallation(): Promise<{
    installation: TexlabStatus['installation'];
    path: string | null;
  }> {
    try {
      return { installation: 'managed', path: await realpath(this.managedExecutable()) };
    } catch {
      const external = await executableOnPath();
      return external
        ? { installation: 'external', path: external }
        : { installation: 'missing', path: null };
    }
  }

  async status(checkVersion = false): Promise<TexlabStatus> {
    const [installation, enabled] = await Promise.all([this.resolveInstallation(), this.enabled()]);
    if (!installation.path) {
      return {
        enabled,
        installation: 'missing',
        path: null,
        version: null,
        detail: 'TexLab is not bundled for this platform and was not found on PATH.',
        running: false,
      };
    }
    let version: string | null = this.service.status.serverInfo?.version ?? null;
    let detail: string | null = null;
    if (checkVersion) {
      try {
        const result = await execFileAsync(installation.path, ['--version'], {
          windowsHide: true,
          timeout: 5_000,
          maxBuffer: 16 * 1024,
        });
        version = parseVersion(`${result.stdout}\n${result.stderr}`);
        detail = version
          ? 'TexLab passed its executable check.'
          : 'TexLab started but did not report a version.';
      } catch {
        return {
          enabled,
          installation: 'error',
          path: installation.path,
          version: null,
          detail: 'TexLab could not run its executable check.',
          running: this.service.status.running,
        };
      }
    }
    return {
      enabled,
      installation: installation.installation,
      path: installation.path,
      version,
      detail,
      running: this.service.status.running,
    };
  }

  async request(request: TexlabRequest): Promise<unknown> {
    this.validateDocument(request);
    if (
      ![
        'completion',
        'hover',
        'definition',
        'references',
        'documentSymbols',
        'foldingRanges',
        'inlayHints',
      ].includes(request.method)
    )
      throw new ProjectError('INVALID_ARGUMENT', 'Unsupported TexLab editor request.');
    if (!(await this.enabled()))
      throw new ProjectError('TEXLAB_DISABLED', 'TexLab is disabled in Settings.');
    const absolute = await this.sync(request);
    switch (request.method) {
      case 'completion': {
        const position = this.position(request);
        return this.service.completion(absolute, position.line, position.character);
      }
      case 'hover': {
        const position = this.position(request);
        return this.service.hover(absolute, position.line, position.character);
      }
      case 'definition': {
        const position = this.position(request);
        return this.service.definition(absolute, position.line, position.character);
      }
      case 'references': {
        const position = this.position(request);
        return this.service.references(absolute, position.line, position.character);
      }
      case 'documentSymbols':
        return this.service.documentSymbols(absolute);
      case 'foldingRanges':
        return this.service.foldingRanges(absolute);
      case 'inlayHints':
        return this.service.request('textDocument/inlayHint', {
          textDocument: { uri: this.fileUri(absolute) },
          range: {
            start: { line: 0, character: 0 },
            end: { line: request.content.split(/\r?\n/).length, character: 0 },
          },
        });
    }
  }

  async sync(request: TexlabDocumentRequest): Promise<string> {
    this.validateDocument(request);
    if (!(await this.enabled()))
      throw new ProjectError('TEXLAB_DISABLED', 'TexLab is disabled in Settings.');
    const absolute = await this.projects.resolvePath(request);
    const root = this.projects.getRoot(request.projectId);
    const installation = await this.resolveInstallation();
    if (!installation.path)
      throw new ProjectError('TOOL_MISSING', 'TexLab is not available for this platform.');
    if (this.currentProjectId !== request.projectId || !this.service.status.running) {
      if (this.currentProjectId !== request.projectId) this.diagnostics.clear();
      await this.service.start({ executable: installation.path, workspaceRoot: root });
      this.currentProjectId = request.projectId;
    }
    await this.service.openDocument({
      path: absolute,
      text: request.content,
      version: request.version,
      languageId: request.path.toLowerCase().endsWith('.bib') ? 'bibtex' : 'latex',
    });
    return absolute;
  }

  async diagnosticsFor(request: FileRef): Promise<Diagnostic[]> {
    await this.projects.resolvePath(request);
    return this.diagnostics.get(this.diagnosticKey(request)) ?? [];
  }

  async stop(): Promise<void> {
    await this.service.stop();
    this.currentProjectId = null;
    this.diagnostics.clear();
  }

  private validateDocument(request: TexlabDocumentRequest): void {
    if (
      !request ||
      typeof request.content !== 'string' ||
      Buffer.byteLength(request.content, 'utf8') > MAX_SOURCE_BYTES ||
      !Number.isSafeInteger(request.version) ||
      request.version < 1
    )
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid or oversized TexLab document request.');
  }

  private position(request: TexlabRequest): { line: number; character: number } {
    const line = request.line;
    const character = request.character;
    if (
      typeof line !== 'number' ||
      !Number.isInteger(line) ||
      line < 0 ||
      typeof character !== 'number' ||
      !Number.isInteger(character) ||
      character < 0
    )
      throw new ProjectError(
        'INVALID_ARGUMENT',
        'This TexLab action requires a valid editor position.',
      );
    return { line, character };
  }

  private fileUri(path: string): string {
    return pathToFileURL(path).href;
  }

  private receiveDiagnostics(params: JsonValue | undefined): void {
    if (!isRecord(params) || typeof params.uri !== 'string' || !Array.isArray(params.diagnostics))
      return;
    const projectId = this.currentProjectId;
    if (!projectId) return;
    try {
      const root = this.projects.getRoot(projectId);
      const absolute = fileURLToPath(params.uri);
      const relativePath = relative(root, absolute).replace(/\\/g, '/');
      if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return;
      const rawDiagnostics: unknown[] = params.diagnostics;
      const converted = rawDiagnostics
        .filter(isRecord)
        .map((item) => this.convertDiagnostic(item, relativePath))
        .filter((item): item is Diagnostic => item !== null)
        .slice(0, MAX_DIAGNOSTICS);
      this.diagnostics.set(`${projectId}:${relativePath.toLowerCase()}`, converted);
    } catch {
      // Ignore diagnostics outside the project boundary or malformed server data.
    }
  }

  private convertDiagnostic(value: Record<string, unknown>, path: string): Diagnostic | null {
    const diagnostic = value as LspDiagnostic;
    if (typeof diagnostic.message !== 'string' || !diagnostic.message.trim()) return null;
    const start =
      isRecord(diagnostic.range) && isRecord(diagnostic.range.start)
        ? diagnostic.range.start
        : null;
    const line =
      start && typeof start.line === 'number' && Number.isInteger(start.line)
        ? start.line + 1
        : undefined;
    const column =
      start && typeof start.character === 'number' && Number.isInteger(start.character)
        ? start.character + 1
        : undefined;
    return {
      severity:
        diagnostic.severity === 1 ? 'error' : diagnostic.severity === 2 ? 'warning' : 'info',
      source: 'texlab',
      message: diagnostic.message.trim(),
      file: path,
      ...(line !== undefined ? { line } : {}),
      ...(column !== undefined ? { column } : {}),
      ...(typeof diagnostic.code === 'string' || typeof diagnostic.code === 'number'
        ? { code: String(diagnostic.code) }
        : {}),
    };
  }

  private diagnosticKey(request: FileRef): string {
    return `${request.projectId}:${request.path.replace(/\\/g, '/').toLowerCase()}`;
  }
}

export { TexlabError };
