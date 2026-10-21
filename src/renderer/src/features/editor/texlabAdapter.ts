import type { Diagnostic, TexlabRequest, TextraAPI } from '../../../../shared/api';
import type { OpenDocument } from '../../state/workspace';
import type {
  TexlabCompletion,
  TexlabDiagnostic,
  TexlabDocumentSymbol,
  TexlabEditorAdapter,
  TexlabEditorDocument,
  TexlabFoldingRange,
  TexlabHover,
  TexlabInlayHint,
  TexlabLocation,
  TexlabPosition,
  TexlabRange,
} from './SourceEditor';

type JsonRecord = Record<string, unknown>;

interface SyncSlot {
  projectId: string;
  path: string;
  latest: { document: TexlabEditorDocument; projectId: string } | null;
  running: Promise<void> | null;
  text: string | null;
  diagnostics: string | null;
  timer?: ReturnType<typeof setTimeout>;
  onDiagnostics: (path: string, diagnostics: readonly Diagnostic[]) => void;
}
interface AdapterRequests {
  sync: Map<string, SyncSlot>;
  requests: Map<string, Promise<unknown>>;
}
// React recreates the adapter when diagnostics change. Coordination belongs to
// the bridge session, so a render cannot restart identical synchronization work.
const sessions = new WeakMap<TextraAPI, AdapterRequests>();

function documentKey(projectId: string, path: string): string {
  return `${projectId}\0${path}`;
}

function record(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function position(value: unknown): TexlabPosition | null {
  if (!record(value)) return null;
  const line = number(value.line);
  const character = number(value.character);
  return line === null || character === null ? null : { line, character };
}

function range(value: unknown): TexlabRange | null {
  if (!record(value)) return null;
  const start = position(value.start);
  const end = position(value.end);
  return start && end ? { start, end } : null;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value
      .map((item) => (record(item) && typeof item.value === 'string' ? item.value : ''))
      .join('');
  if (record(value) && typeof value.value === 'string') return value.value;
  return undefined;
}

function absolutePath(uri: string): string {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:') return uri;
    const pathname = decodeURIComponent(url.pathname);
    return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname;
  } catch {
    return uri;
  }
}

function parseCompletions(value: unknown): TexlabCompletion[] {
  const items = Array.isArray(value)
    ? value
    : record(value) && Array.isArray(value.items)
      ? value.items
      : [];
  return items.filter(record).flatMap((item) => {
    if (typeof item.label !== 'string') return [];
    const documentation = text(item.documentation);
    const edit =
      record(item.textEdit) && typeof item.textEdit.newText === 'string' ? item.textEdit : null;
    const editText = edit && typeof edit.newText === 'string' ? edit.newText : undefined;
    return [
      {
        label: item.label,
        ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
        ...(documentation ? { documentation } : {}),
        ...(typeof item.insertText === 'string' ? { insertText: item.insertText } : {}),
        ...(typeof item.filterText === 'string' ? { filterText: item.filterText } : {}),
        ...(typeof item.sortText === 'string' ? { sortText: item.sortText } : {}),
        ...(editText ? { insertText: editText, range: range(edit?.range) ?? undefined } : {}),
      },
    ];
  });
}

function parseHover(value: unknown): TexlabHover | null {
  if (!record(value)) return null;
  const contents = text(value.contents);
  return contents
    ? { contents, ...(range(value.range) ? { range: range(value.range)! } : {}) }
    : null;
}

function parseLocations(value: unknown): TexlabLocation[] {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.filter(record).flatMap((item) => {
    const uri =
      typeof item.targetUri === 'string'
        ? item.targetUri
        : typeof item.uri === 'string'
          ? item.uri
          : null;
    const locationRange =
      range(item.targetSelectionRange) ?? range(item.targetRange) ?? range(item.range);
    return uri && locationRange ? [{ path: absolutePath(uri), uri, range: locationRange }] : [];
  });
}

function parseSymbols(value: unknown): TexlabDocumentSymbol[] {
  if (!Array.isArray(value)) return [];
  return value.filter(record).flatMap((symbol) => {
    const symbolRange = range(symbol.range);
    if (typeof symbol.name !== 'string' || !symbolRange) return [];
    return [
      {
        name: symbol.name,
        ...(typeof symbol.detail === 'string' ? { detail: symbol.detail } : {}),
        ...(typeof symbol.kind === 'number' ? { kind: symbol.kind } : {}),
        range: symbolRange,
        ...(range(symbol.selectionRange) ? { selectionRange: range(symbol.selectionRange)! } : {}),
        ...(Array.isArray(symbol.children) ? { children: parseSymbols(symbol.children) } : {}),
      },
    ];
  });
}

function parseFolding(value: unknown): TexlabFoldingRange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(record).flatMap((item) => {
    const startLine = number(item.startLine);
    const endLine = number(item.endLine);
    if (startLine === null || endLine === null) return [];
    return [
      {
        startLine,
        endLine,
        ...(number(item.startCharacter) !== null
          ? { startCharacter: number(item.startCharacter)! }
          : {}),
        ...(number(item.endCharacter) !== null ? { endCharacter: number(item.endCharacter)! } : {}),
        ...(item.kind === 'comment' || item.kind === 'imports' || item.kind === 'region'
          ? { kind: item.kind }
          : {}),
      },
    ];
  });
}

function parseInlayHints(value: unknown): TexlabInlayHint[] {
  if (!Array.isArray(value)) return [];
  return value.filter(record).flatMap((item) => {
    const hintPosition = position(item.position);
    const label = text(item.label);
    if (!hintPosition || !label) return [];
    return [
      {
        position: hintPosition,
        label,
        ...(typeof item.tooltip === 'string' ? { tooltip: item.tooltip } : {}),
        ...(item.kind === 2 ? { kind: 'parameter' as const } : { kind: 'type' as const }),
        ...(typeof item.paddingLeft === 'boolean' ? { paddingLeft: item.paddingLeft } : {}),
        ...(typeof item.paddingRight === 'boolean' ? { paddingRight: item.paddingRight } : {}),
      },
    ];
  });
}

export function texlabMarkers(diagnostics: readonly Diagnostic[]): TexlabDiagnostic[] {
  return diagnostics.flatMap((diagnostic) => {
    if (!diagnostic.line) return [];
    const startLine = diagnostic.line - 1;
    const startCharacter = Math.max(0, (diagnostic.column ?? 1) - 1);
    return [
      {
        range: {
          start: { line: startLine, character: startCharacter },
          end: { line: startLine, character: startCharacter + 1 },
        },
        severity: diagnostic.severity,
        message: diagnostic.message,
        ...(diagnostic.code ? { code: diagnostic.code } : {}),
        source: 'TexLab',
      },
    ];
  });
}

export function createTexlabAdapter({
  documents,
  ready,
  diagnostics,
  onDiagnostics,
}: {
  documents: readonly OpenDocument[];
  ready: boolean;
  diagnostics: ReadonlyMap<string, readonly TexlabDiagnostic[]>;
  onDiagnostics: (path: string, diagnostics: readonly Diagnostic[]) => void;
}): TexlabEditorAdapter {
  const bridge = window.textra;
  let state = sessions.get(bridge);
  if (!state) {
    state = { sync: new Map(), requests: new Map() };
    sessions.set(bridge, state);
  }
  const session = state;
  const openKeys = new Set(
    documents.map((document) => documentKey(document.projectId, document.path)),
  );
  for (const [key, slot] of session.sync) {
    if (!ready || !openKeys.has(key)) {
      slot.latest = null;
      if (slot.timer) clearTimeout(slot.timer);
      session.sync.delete(key);
      void bridge
        .closeTexlabDocument({ projectId: slot.projectId, path: slot.path })
        .catch(() => undefined);
    } else slot.onDiagnostics = onDiagnostics;
  }
  const open = (path: string) => documents.find((document) => document.path === path) ?? null;
  const request = async (
    document: TexlabEditorDocument,
    method: TexlabRequest['method'],
    position?: TexlabPosition,
  ): Promise<unknown> => {
    const openDocument = open(document.path);
    if (!openDocument) throw new Error('The TexLab document is no longer open.');
    const key = JSON.stringify([
      openDocument.projectId,
      document.path,
      document.version,
      method,
      position,
    ]);
    const pending = session.requests.get(key);
    if (pending) return pending;
    const run = bridge
      .texlabRequest({
        projectId: openDocument.projectId,
        path: document.path,
        content: document.text,
        version: document.version,
        method,
        ...(position ? { line: position.line, character: position.character } : {}),
      })
      .then((result) => {
        if (!result.ok) throw new Error(result.error);
        return result.value;
      })
      .finally(() => session.requests.delete(key));
    session.requests.set(key, run);
    return run;
  };
  const sync = async (document: TexlabEditorDocument) => {
    const openDocument = open(document.path);
    if (!openDocument) return;
    const key = documentKey(openDocument.projectId, document.path);
    let slot = session.sync.get(key);
    if (!slot) {
      slot = {
        projectId: openDocument.projectId,
        path: document.path,
        latest: null,
        running: null,
        text: null,
        diagnostics: null,
        onDiagnostics,
      };
      session.sync.set(key, slot);
    }
    const current = slot;
    if (current.text === document.text && !current.running) return;
    current.latest = { document, projectId: openDocument.projectId };
    if (current.running) return current.running;
    current.running = (async () => {
      while (current.latest && session.sync.get(key) === current) {
        const next = current.latest;
        current.latest = null;
        if (current.text === next.document.text) continue;
        const result = await bridge.syncTexlabDocument({
          projectId: next.projectId,
          path: next.document.path,
          content: next.document.text,
          version: next.document.version,
        });
        if (!result.ok) throw new Error(result.error);
        if (session.sync.get(key) !== current) return;
        current.text = next.document.text;
        if (current.timer) clearTimeout(current.timer);
        current.timer = setTimeout(() => {
          void bridge
            .getTexlabDiagnostics({ projectId: next.projectId, path: next.document.path })
            .then((latest) => {
              if (!latest.ok || session.sync.get(key) !== current) return;
              const signature = JSON.stringify(latest.value);
              if (signature === current.diagnostics) return;
              current.diagnostics = signature;
              current.onDiagnostics(next.document.path, latest.value);
            })
            .catch(() => undefined);
        }, 300);
      }
    })().finally(() => {
      current.running = null;
    });
    return current.running;
  };
  return {
    isReady: ready,
    diagnostics,
    syncDocument: ready ? sync : undefined,
    requestCompletion: ready
      ? async (document, position) =>
          parseCompletions(await request(document, 'completion', position))
      : undefined,
    requestHover: ready
      ? async (document, position) => parseHover(await request(document, 'hover', position))
      : undefined,
    requestDefinition: ready
      ? async (document, position) =>
          parseLocations(await request(document, 'definition', position))
      : undefined,
    requestReferences: ready
      ? async (document, position) =>
          parseLocations(await request(document, 'references', position))
      : undefined,
    requestDocumentSymbols: ready
      ? async (document) => parseSymbols(await request(document, 'documentSymbols'))
      : undefined,
    requestFoldingRanges: ready
      ? async (document) => parseFolding(await request(document, 'foldingRanges'))
      : undefined,
    requestInlayHints: ready
      ? async (document) => parseInlayHints(await request(document, 'inlayHints'))
      : undefined,
  };
}
