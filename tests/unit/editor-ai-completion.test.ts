import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Monaco from 'monaco-editor/editor/editor.api.js';
import type { AISettings } from '../../src/shared/api';
import { installAICompletion } from '../../src/renderer/src/features/editor/ai-completion';
import {
  inlineEditPreview,
  installInlineEdit,
} from '../../src/renderer/src/features/editor/inline-edit';
vi.mock('../../src/renderer/src/features/chat/ModelPicker', () => ({ ModelPicker: () => null }));

interface PromptHarness {
  onInstruction(value: string): void;
  onModel(value: { provider: 'google'; model: string }): void;
  generate(): void;
  accept(): void;
  replacement: string | null;
  status: string;
  instruction: string;
  blocked: boolean;
  loading: boolean;
}
const promptHarness = vi.hoisted(() => ({
  current: null as PromptHarness | null,
  unmount: vi.fn(),
}));
vi.mock('react-dom/client', () => ({
  createRoot: () => ({
    render: (element: { props: PromptHarness }) => {
      promptHarness.current = element.props;
    },
    unmount: promptHarness.unmount,
  }),
}));

vi.mock('monaco-editor/editor/editor.api.js', () => ({
  editor: { EditorOption: { readOnly: 1 } },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { KeyI: 39, Enter: 3 },
  Selection: { selectionsEqual: (left: unknown, right: unknown) => left === right },
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

function inlineFixture(selected = '') {
  const source = `Before ${selected} after`;
  let version = 1;
  let revision = 'rev';
  const events = new Map<string, () => void>();
  const listen = (name: string) => (callback: () => void) => {
    events.set(name, callback);
    return { dispose() {} };
  };
  const selection = {
    startLineNumber: 1,
    startColumn: 8,
    endLineNumber: 1,
    endColumn: 8 + selected.length,
    getStartPosition: () => ({ lineNumber: 1, column: 8 }),
    getEndPosition: () => ({ lineNumber: 1, column: 8 + selected.length }),
    isEmpty: () => !selected,
  };
  const keyboardTarget = new EventTarget();
  const node = { ownerDocument: keyboardTarget, closest: () => null, querySelector: () => null };
  const model = {
    getValue: () => source,
    getVersionId: () => version,
    getOffsetAt: (position: { column: number }) => position.column - 1,
    getValueInRange: () => selected,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
  };
  const editor = {
    getDomNode: () => node,
    getModel: () => model,
    getSelection: () => selection,
    getSelections: () => [selection],
    getOption: () => false,
    hasTextFocus: () => true,
    focus: vi.fn(),
    revealLineInCenter: vi.fn(),
    getAction: () => null,
    addAction: () => ({ dispose() {} }),
    trigger: vi.fn(),
    pushUndoStop: vi.fn(),
    executeEdits: vi.fn(() => true),
    setPosition: vi.fn(),
    changeViewZones: (callback: (accessor: unknown) => void) =>
      callback({ addZone: () => 'zone', removeZone: vi.fn(), layoutZone: vi.fn() }),
    onDidChangeModelContent: listen('content'),
    onDidChangeModel: listen('model'),
    onDidChangeCursorSelection: listen('cursor'),
    onDidCompositionStart: listen('composition'),
    onDidCompositionEnd: listen('compositionEnd'),
  };
  const modelRef = { provider: 'google' as const, model: 'gemini-test' };
  const requestAIInlineEdit = vi.fn(async (request) => ({
    ok: true,
    value: {
      requestId: request.requestId,
      modelVersion: request.modelVersion,
      offset: request.offset,
      endOffset: request.endOffset,
      text: 'Rewritten',
    },
  }));
  const cancelAIInlineEdit = vi.fn(async () => ({ ok: true }));
  const chunkListeners = new Set<(chunk: { requestId: string; text: string }) => void>();
  const onAIInlineEditChunk = vi.fn((listener) => {
    chunkListeners.add(listener);
    return () => chunkListeners.delete(listener);
  });
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', {
    textra: { requestAIInlineEdit, cancelAIInlineEdit, onAIInlineEditChunk },
    dispatchEvent,
  });
  vi.stubGlobal('document', {
    createElement: () => ({
      className: '',
      closest: () => null,
      querySelector: () => ({ focus() {} }),
    }),
  });
  const controller = installInlineEdit(
    editor as unknown as Monaco.editor.IStandaloneCodeEditor,
    () => ({
      document: {
        projectId: 'project',
        path: 'main.tex',
        revision,
        conflict: false,
      } as never,
      settings: null,
      model: modelRef,
    }),
    vi.fn(),
    vi.fn(),
  );
  return {
    controller,
    editor,
    requestAIInlineEdit,
    cancelAIInlineEdit,
    keyboardTarget,
    dispatchEvent,
    chunk: (requestId: string, text: string) => {
      for (const listener of chunkListeners) listener({ requestId, text });
    },
    chunkListeners,
    saved: () => {
      revision = 'saved-revision';
    },
    edit: () => {
      version++;
      events.get('content')?.();
    },
  };
}

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
    roleDefaults: { assistant: ref, completion: ref, inlineCompletion: ref },
    completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
    providers: [
      {
        id: ref.provider,
        configured: true,
        enabled: true,
        models: [{ id: ref.model, label: ref.model }],
      },
    ],
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
describe('prompted inline AI edits', () => {
  it('hides partial fence wrappers without normalizing document whitespace', () => {
    expect(inlineEditPreview('``')).toBe('');
    expect(inlineEditPreview('```latex')).toBe('');
    expect(inlineEditPreview('```latex\r\n  new\r\n`')).toBe('  new');
    expect(inlineEditPreview('```latex\n  new\n```')).toBe('  new');
    expect(inlineEditPreview('  text\n')).toBe('  text\n');
  });
  it('streams cumulative previews but blocks acceptance until successful completion', async () => {
    const f = inlineFixture('selected');
    let resolve!: (value: unknown) => void;
    f.requestAIInlineEdit.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as never,
    );
    f.controller.open();
    promptHarness.current!.onInstruction('Rewrite');
    promptHarness.current!.generate();
    const request = f.requestAIInlineEdit.mock.calls[0][0];
    expect(f.chunkListeners.size).toBe(1);
    f.chunk('unrelated', 'wrong response');
    expect(promptHarness.current!.replacement).toBeNull();
    f.chunk(request.requestId, '```latex\nnew');
    expect(promptHarness.current!.replacement).toBe('new');
    f.chunk(request.requestId, '```latex\nnew text\n```');
    expect(promptHarness.current!.replacement).toBe('new text');
    expect(promptHarness.current!.loading).toBe(true);
    expect(f.controller.accept()).toBe(false);
    expect(f.editor.executeEdits).not.toHaveBeenCalled();
    resolve({ ok: true, value: { ...request, text: 'new text' } });
    await Promise.resolve();
    expect(f.chunkListeners.size).toBe(0);
    expect(promptHarness.current!.loading).toBe(false);
    expect(f.controller.accept()).toBe(true);
    expect(f.editor.pushUndoStop).toHaveBeenCalledTimes(2);
    f.controller.dispose();
  });
  it('clears failed partial previews and unsubscribes after cancellation', async () => {
    const f = inlineFixture();
    let resolve!: (value: unknown) => void;
    f.requestAIInlineEdit.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as never,
    );
    f.controller.open();
    promptHarness.current!.onInstruction('Continue');
    promptHarness.current!.generate();
    const request = f.requestAIInlineEdit.mock.calls[0][0];
    f.chunk(request.requestId, 'partial');
    resolve({ ok: false, error: 'Connection interrupted' });
    await Promise.resolve();
    expect(promptHarness.current!.replacement).toBeNull();
    expect(promptHarness.current!.status).toBe('Connection interrupted');
    expect(f.chunkListeners.size).toBe(0);
    expect(f.controller.accept()).toBe(false);
    f.controller.dispose();
  });
  it('preserves the instruction when Ctrl+I reopens the same anchor and explains oversized selections', () => {
    const f = inlineFixture();
    f.controller.open();
    promptHarness.current!.onInstruction('Keep my instruction');
    f.controller.open();
    expect(promptHarness.current!.instruction).toBe('Keep my instruction');
    f.controller.dispose();
    const oversized = inlineFixture('x'.repeat(16_001));
    oversized.controller.open();
    expect(promptHarness.current!.blocked).toBe(true);
    expect(promptHarness.current!.status).toContain('16,000');
    promptHarness.current!.onInstruction('Rewrite');
    promptHarness.current!.generate();
    expect(oversized.requestAIInlineEdit).not.toHaveBeenCalled();
    oversized.controller.dispose();
  });
  it('opens a prompt without sharing source and generates only after explicit submission', async () => {
    const f = inlineFixture('selected text');
    f.controller.open();
    expect(f.requestAIInlineEdit).not.toHaveBeenCalled();
    promptHarness.current!.onInstruction('Make the selection concise');
    expect(f.requestAIInlineEdit).not.toHaveBeenCalled();
    promptHarness.current!.generate();
    await Promise.resolve();
    expect(f.requestAIInlineEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: 'Make the selection concise',
        selection: 'selected text',
        prefix: 'Before ',
        suffix: ' after',
        offset: 7,
        endOffset: 20,
      }),
    );
    expect(promptHarness.current!.replacement).toBe('Rewritten');
    expect(f.controller.accept()).toBe(true);
    expect(f.editor.executeEdits).toHaveBeenCalledOnce();
    expect(f.editor.pushUndoStop).toHaveBeenCalledTimes(2);
    expect(f.controller.accept()).toBe(false);
    f.controller.dispose();
  });
  it('cancels a generated preview on model change without sending another request', async () => {
    const f = inlineFixture();
    f.controller.open();
    promptHarness.current!.onInstruction('Insert a short explanation');
    promptHarness.current!.generate();
    await Promise.resolve();
    expect(promptHarness.current!.replacement).toBe('Rewritten');
    promptHarness.current!.onModel({ provider: 'google', model: 'another-model' });
    expect(promptHarness.current!.replacement).toBeNull();
    expect(f.requestAIInlineEdit).toHaveBeenCalledOnce();
    expect(f.controller.accept()).toBe(false);
    f.controller.dispose();
  });
  it('preserves an edit when autosave updates only the unchanged buffer disk revision', async () => {
    const f = inlineFixture('selected');
    f.controller.open();
    promptHarness.current!.onInstruction('Make concise');
    f.saved();
    promptHarness.current!.generate();
    await Promise.resolve();
    expect(f.requestAIInlineEdit.mock.calls[0][0].revision).toBe('saved-revision');
    f.saved();
    expect(f.controller.accept()).toBe(true);
    f.controller.dispose();
  });
  it('invalidates a response after source edits and cancels only its request ID', async () => {
    const f = inlineFixture();
    let resolve!: (value: unknown) => void;
    f.requestAIInlineEdit.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as never,
    );
    f.controller.open();
    promptHarness.current!.onInstruction('Continue');
    promptHarness.current!.generate();
    const request = f.requestAIInlineEdit.mock.calls[0][0];
    f.edit();
    expect(f.cancelAIInlineEdit).toHaveBeenCalledWith({ requestId: request.requestId });
    resolve({ ok: true, value: { ...request, text: 'late' } });
    await Promise.resolve();
    expect(f.controller.accept()).toBe(false);
    f.controller.dispose();
  });
  it('dispatches Ctrl+Enter compilation once and prevents the editor newline', () => {
    const f = inlineFixture();
    const event = Object.assign(new Event('keydown', { cancelable: true }), {
      key: 'Enter',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    });
    f.keyboardTarget.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(f.dispatchEvent).toHaveBeenCalledOnce();
    expect(f.dispatchEvent.mock.calls[0][0].type).toBe('textra:compile');
    f.controller.dispose();
  });
  it('opens Ctrl+I without a provider request and times out prompted edits at 60 seconds', async () => {
    vi.useFakeTimers();
    const f = inlineFixture();
    const event = Object.assign(new Event('keydown', { cancelable: true }), {
      key: 'i',
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    });
    f.keyboardTarget.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(f.requestAIInlineEdit).not.toHaveBeenCalled();
    let resolve!: (value: unknown) => void;
    f.requestAIInlineEdit.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as never,
    );
    promptHarness.current!.onInstruction('Insert a proof');
    promptHarness.current!.generate();
    const request = f.requestAIInlineEdit.mock.calls[0][0];
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.cancelAIInlineEdit).toHaveBeenCalledWith({ requestId: request.requestId });
    expect(promptHarness.current!.status).toContain('timed out');
    resolve({ ok: true, value: { ...request, text: 'late' } });
    await Promise.resolve();
    expect(f.controller.accept()).toBe(false);
    f.controller.dispose();
  });
});
describe('editor AI completion coordination', () => {
  it('skips automatic IPC for silenced or hidden saved bindings', async () => {
    vi.useFakeTimers();
    const f = fixture('\\begin{equation}x = ');
    f.settings.completion = {
      enabled: true,
      allowOutsideEnvironments: false,
      consentedModel: f.settings.roleDefaults.completion,
    };
    f.settings.providers[0].enabled = false;
    f.edit();
    await vi.advanceTimersByTimeAsync(750);
    expect(f.requestAICompletion).not.toHaveBeenCalled();
    f.settings.providers[0].enabled = true;
    f.settings.providers[0].filters = {
      chat: { mode: 'all', models: [] },
      completion: { mode: 'include', models: [] },
    };
    f.edit();
    await vi.advanceTimersByTimeAsync(750);
    expect(f.requestAICompletion).not.toHaveBeenCalled();
    f.controller.dispose();
  });
  it('keeps empty automatic results quiet and never offers an empty insertion', async () => {
    vi.useFakeTimers();
    const f = fixture('\\begin{equation}x = ');
    f.settings.completion = {
      enabled: true,
      allowOutsideEnvironments: false,
      consentedModel: f.settings.roleDefaults.completion,
    };
    f.requestAICompletion.mockImplementationOnce(async (request) => ({
      ok: true,
      value: {
        requestId: request.requestId,
        modelVersion: request.modelVersion,
        offset: request.offset,
        text: '',
      },
    }));
    f.edit();
    await vi.advanceTimersByTimeAsync(750);
    expect(f.controller.accept()).toBe(false);
    expect(f.view.mock.lastCall?.[0].status).toBe('');
    f.controller.dispose();
  });
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
  it('cancels automatic completion at ten seconds and discards its response', async () => {
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
