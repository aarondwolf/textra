import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Monaco from 'monaco-editor/editor/editor.api.js';
import type { AISettings } from '../../src/shared/api';
import { installAICompletion } from '../../src/renderer/src/features/editor/ai-completion';

vi.mock('monaco-editor/editor/editor.api.js', () => ({
  editor: { EditorOption: { readOnly: 1 } },
  Range: class {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
  languages: { registerInlineCompletionsProvider: () => ({ dispose() {} }) },
}));

function fixture(source = 'Some prose', local = false) {
  const events = new Map<string, (...args: never[]) => void>();
  const listen = (name: string) => (handler: (...args: never[]) => void) => {
    events.set(name, handler);
    return { dispose() {} };
  };
  const node = Object.assign(new EventTarget(), {
    clientWidth: 800,
    querySelector: () => null,
    closest: () => null,
  });
  let offset = source === 'Some prose' ? 4 : source.length;
  let version = 1;
  const model = {
    getVersionId: () => version,
    getOffsetAt: () => offset,
    getValue: () => source,
    getPositionAt: (value: number) => ({ lineNumber: 1, column: value + 1 }),
    getLineContent: () => 'Some prose',
    getLineMaxColumn: () => 11,
  };
  const editor = {
    getDomNode: () => node,
    getModel: () => model,
    getPosition: () => ({ lineNumber: 1, column: offset + 1 }),
    getScrolledVisiblePosition: () => ({ top: 0, left: 0, height: 23 }),
    getContribution: () => null,
    getOption: () => false,
    getSelections: () => [{}],
    getSelection: () => ({ isEmpty: () => true }),
    hasTextFocus: () => true,
    trigger: vi.fn(),
    pushUndoStop: vi.fn(),
    executeEdits: vi.fn(() => true),
    focus: vi.fn(),
    setPosition: vi.fn(),
    onDidChangeModelContent: listen('content'),
    onDidChangeCursorSelection: listen('cursor'),
    onDidChangeModel: listen('model'),
    onDidChangeConfiguration: listen('configuration'),
    onDidCompositionStart: listen('composition'),
    onDidCompositionEnd: listen('compositionEnd'),
    onDidScrollChange: listen('scroll'),
  };
  const ref = {
    provider: local ? ('ollama-local' as const) : ('google' as const),
    model: local ? 'qwen2.5-coder:1.5b' : 'gemini-test',
  };
  const settings = {
    roleDefaults: { chat: ref, agent: ref, completion: ref, inlineCompletion: ref },
    completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
  } as AISettings;
  const requestAICompletion = vi.fn(async (request) => ({
    ok: true,
    value: {
      requestId: request.requestId,
      modelVersion: request.modelVersion,
      offset: request.offset,
      text: ' continuation',
    },
  }));
  const cancelAICompletion = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('window', { textra: { requestAICompletion, cancelAICompletion } });
  const view = vi.fn();
  const controller = installAICompletion(
    editor as unknown as Monaco.editor.IStandaloneCodeEditor,
    () => ({
      document: {
        projectId: 'project',
        path: 'main.tex',
        revision: 'rev',
        conflict: false,
      } as never,
      settings,
      manualModel: ref,
    }),
    view,
  );
  return {
    controller,
    editor,
    events,
    view,
    settings,
    requestAICompletion,
    cancelAICompletion,
    move: () => {
      offset++;
      events.get('cursor')?.();
    },
    edit: () => {
      version++;
      events.get('content')?.();
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('editor AI completion coordination', () => {
  it('bounds local context and permits CPU inference beyond the remote manual deadline', async () => {
    vi.useFakeTimers();
    const f = fixture('x'.repeat(20_000), true);
    let resolve!: (value: unknown) => void;
    f.requestAICompletion.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as never,
    );
    const pending = f.controller.request();
    const request = f.requestAICompletion.mock.calls[0][0];
    expect(request.prefix).toHaveLength(4096);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.cancelAICompletion).not.toHaveBeenCalled();
    resolve({ ok: true, value: { ...request, text: 'continuation' } });
    await pending;
    expect(f.controller.accept()).toBe(true);
    f.controller.dispose();
  });
  it('requests manual prose continuation while automatic suggestions are disabled and accepts once', async () => {
    const f = fixture();
    await f.controller.request();
    expect(f.requestAICompletion).toHaveBeenCalledOnce();
    expect(f.requestAICompletion.mock.calls[0][0]).toMatchObject({
      role: 'inlineCompletion',
      prefix: 'Some',
      suffix: ' prose',
    });
    expect(f.controller.accept()).toBe(true);
    expect(f.editor.executeEdits).toHaveBeenCalledOnce();
    expect(f.editor.pushUndoStop).toHaveBeenCalledTimes(2);
    expect(f.controller.accept()).toBe(false);
    f.controller.dispose();
  });
  it('cancels only the pending request and discards late responses after cursor movement', async () => {
    const f = fixture();
    let resolve!: (value: unknown) => void;
    f.requestAICompletion.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as never,
    );
    const pending = f.controller.request();
    const request = f.requestAICompletion.mock.calls[0][0];
    f.move();
    expect(f.cancelAICompletion).toHaveBeenCalledWith({ requestId: request.requestId });
    resolve({ ok: true, value: { ...request, text: 'late' } });
    await pending;
    expect(f.controller.accept()).toBe(false);
    f.controller.dispose();
  });
  it('regeneration issues a new request instead of replaying the cached suggestion', async () => {
    const f = fixture();
    await f.controller.request();
    await f.controller.request();
    expect(f.requestAICompletion).toHaveBeenCalledTimes(2);
    f.controller.dispose();
  });
  it('does not automatically share ordinary prose or any text before enabling suggestions', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.edit();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(f.requestAICompletion).not.toHaveBeenCalled();
    f.settings.completion = {
      enabled: true,
      allowOutsideEnvironments: false,
      consentedModel: f.settings.roleDefaults.completion,
    };
    f.edit();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(f.requestAICompletion).not.toHaveBeenCalled();
    f.controller.dispose();
  });
  it('debounces eligible math for 750 ms and limits automatic starts to one per two seconds', async () => {
    vi.useFakeTimers();
    const f = fixture('\\begin{equation}x = ');
    f.settings.completion = {
      enabled: true,
      allowOutsideEnvironments: false,
      consentedModel: f.settings.roleDefaults.completion,
    };
    f.edit();
    await vi.advanceTimersByTimeAsync(749);
    expect(f.requestAICompletion).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.requestAICompletion).toHaveBeenCalledOnce();
    f.edit();
    await vi.advanceTimersByTimeAsync(750);
    expect(f.requestAICompletion).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_250);
    f.edit();
    await vi.advanceTimersByTimeAsync(750);
    // Same context may reuse the bounded memory cache without another request.
    expect(f.requestAICompletion.mock.calls.length).toBeLessThanOrEqual(2);
    f.controller.dispose();
  });
  it('cancels a manual request at 15 seconds and cannot apply its late response', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let resolve!: (value: unknown) => void;
    f.requestAICompletion.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as never,
    );
    const pending = f.controller.request();
    const request = f.requestAICompletion.mock.calls[0][0];
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.cancelAICompletion).toHaveBeenCalledWith({ requestId: request.requestId });
    resolve({ ok: true, value: { ...request, text: 'late' } });
    await pending;
    expect(f.controller.accept()).toBe(false);
    expect(f.view.mock.lastCall?.[0].status).toContain('timed out');
    f.controller.dispose();
  });
  it('cancels automatic completion at 2.5 seconds and discards its response', async () => {
    vi.useFakeTimers();
    const f = fixture('\\begin{equation}x = ');
    f.settings.completion = {
      enabled: true,
      allowOutsideEnvironments: false,
      consentedModel: f.settings.roleDefaults.completion,
    };
    let resolve!: (value: unknown) => void;
    f.requestAICompletion.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as never,
    );
    f.edit();
    await vi.advanceTimersByTimeAsync(750);
    const request = f.requestAICompletion.mock.calls[0][0];
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.cancelAICompletion).toHaveBeenCalledWith({ requestId: request.requestId });
    resolve({ ok: true, value: { ...request, text: 'late' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.controller.accept()).toBe(false);
    expect(f.view.mock.lastCall?.[0].status).toContain('timed out');
    f.controller.dispose();
  });
});
