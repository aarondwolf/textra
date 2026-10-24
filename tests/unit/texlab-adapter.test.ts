import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTexlabAdapter } from '../../src/renderer/src/features/editor/texlabAdapter';
import type { TexlabEditorDocument } from '../../src/renderer/src/features/editor/SourceEditor';
import type { OpenDocument } from '../../src/renderer/src/state/workspace';
import type { Diagnostic, Result, TexlabDocumentRequest } from '../../src/shared/api';

const source: TexlabEditorDocument = {
  path: 'main.tex',
  uri: 'file:///main.tex',
  languageId: 'latex',
  version: 1,
  text: 'initial',
};
const open: OpenDocument = {
  projectId: 'project',
  path: 'main.tex',
  content: 'initial',
  savedContent: 'initial',
  revision: 'revision',
  conflict: false,
  externalState: null,
};

describe('TexLab renderer coordination', () => {
  let sync: ReturnType<typeof vi.fn<(request: TexlabDocumentRequest) => Promise<Result<void>>>>;
  let request: ReturnType<typeof vi.fn<() => Promise<Result<unknown>>>>;
  let onDiagnostics: ReturnType<
    typeof vi.fn<(path: string, diagnostics: readonly Diagnostic[]) => void>
  >;
  const adapter = (documents = [open]) =>
    createTexlabAdapter({ documents, ready: true, diagnostics: new Map(), onDiagnostics });
  beforeEach(() => {
    vi.useFakeTimers();
    sync = vi.fn(async () => ({ ok: true, value: undefined }));
    request = vi.fn(async () => ({ ok: true, value: [{ label: 'completion' }] }));
    onDiagnostics = vi.fn<(path: string, diagnostics: readonly Diagnostic[]) => void>();
    vi.stubGlobal('window', {
      textra: {
        syncTexlabDocument: sync,
        closeTexlabDocument: vi.fn(async () => ({ ok: true, value: undefined })),
        texlabRequest: request,
        getTexlabDiagnostics: vi.fn(async () => ({ ok: true, value: [] })),
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('does not re-sync identical content when diagnostics recreate the adapter', async () => {
    await adapter().syncDocument!(source);
    await vi.advanceTimersByTimeAsync(300);
    expect(onDiagnostics).toHaveBeenCalledTimes(1);
    await adapter().syncDocument!({ ...source, version: 2 });
    await vi.advanceTimersByTimeAsync(300);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(onDiagnostics).toHaveBeenCalledTimes(1);
  });
  it('coalesces intermediate edits while an IPC sync is pending', async () => {
    let finish!: (result: Result<void>) => void;
    sync.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const current = adapter();
    const first = current.syncDocument!(source);
    const intermediate = current.syncDocument!({ ...source, version: 2, text: 'middle' });
    const latest = current.syncDocument!({ ...source, version: 3, text: 'latest' });
    expect(sync).toHaveBeenCalledTimes(1);
    finish({ ok: true, value: undefined });
    await Promise.all([first, intermediate, latest]);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync.mock.calls[1][0]).toMatchObject({ content: 'latest', version: 3 });
  });
  it('shares identical pending language requests across adapter instances', async () => {
    let finish!: (result: Result<unknown>) => void;
    request.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const first = adapter().requestCompletion!(source, { line: 0, character: 1 });
    const second = adapter().requestCompletion!(source, { line: 0, character: 1 });
    expect(request).toHaveBeenCalledTimes(1);
    finish({ ok: true, value: [{ label: 'shared' }] });
    expect(await first).toEqual([{ label: 'shared' }]);
    expect(await second).toEqual([{ label: 'shared' }]);
  });
  it('does not republish identical diagnostics after later edits', async () => {
    await adapter().syncDocument!(source);
    await vi.advanceTimersByTimeAsync(300);
    await adapter().syncDocument!({ ...source, version: 2, text: 'edited' });
    await vi.advanceTimersByTimeAsync(300);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(onDiagnostics).toHaveBeenCalledTimes(1);
  });
  it('invalidates synchronization state and diagnostics timers when a document closes', async () => {
    await adapter().syncDocument!(source);
    adapter([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(onDiagnostics).not.toHaveBeenCalled();
    await adapter().syncDocument!(source);
    expect(sync).toHaveBeenCalledTimes(2);
  });
  it('resynchronizes unchanged open text after a cancelled shutdown restarts resources', async () => {
    await adapter().syncDocument!(source);
    const restarted = createTexlabAdapter({
      documents: [open],
      ready: true,
      diagnostics: new Map(),
      onDiagnostics,
      resourceEpoch: 1,
    });
    await restarted.syncDocument!(source);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(restarted.resourceEpoch).toBe(1);
  });
});
