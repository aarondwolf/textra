import * as monaco from 'monaco-editor/editor/editor.api.js';
import type { AISettings } from '../../../../shared/api';
import {
  completionTimeout,
  isLocalAIModel,
  sameModel,
  type AICompletionRequest,
  type AICompletionRole,
  type AIModelRef,
} from '../../../../shared/ai';
import { buildCompletionContext } from '../../../../shared/latex-completion';
import type { OpenDocument } from '../../state/workspace';
import { modelUnavailableReason } from '../chat/useAISettings';

export interface CompletionView {
  visible: boolean;
  manual: boolean;
  status: string;
  ready: boolean;
  top: number;
  left: number;
}
interface Snapshot {
  document: OpenDocument;
  settings: AISettings | null;
  manualModel: AIModelRef | null;
}
interface Suggestion {
  request: AICompletionRequest;
  text: string;
  key: string;
}

/** Owns cancellation and insertion checks; no source or suggestions leave memory. */
export function installAICompletion(
  editor: monaco.editor.IStandaloneCodeEditor,
  snapshot: () => Snapshot | null,
  onView: (view: CompletionView) => void,
) {
  let generation = 0;
  let pending: string | null = null;
  let suggestion: Suggestion | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let composing = false;
  let manual = false;
  let lastAutomatic = -Infinity;
  let suspended = false;
  let status = '';
  let errorCode: string | undefined;
  let disposed = false;
  const cache = new Map<string, { text: string; expires: number }>();
  const dismissed = new Set<string>();
  const node = editor.getDomNode()!;
  const view = () => {
    const health = suspended
      ? 'paused'
      : pending
        ? 'loading'
        : suggestion
          ? 'ready'
          : status
            ? 'error'
            : 'idle';
    window.dispatchEvent?.(
      new CustomEvent('textra-ai-completion-health', {
        detail: {
          status: health,
          ...(status && !pending ? { error: status, code: errorCode } : {}),
        },
      }),
    );
    const position = editor.getPosition();
    const anchor = position ? editor.getScrolledVisiblePosition(position) : null;
    onView({
      visible: manual || Boolean(suggestion) || Boolean(status),
      manual,
      status,
      ready: Boolean(suggestion),
      top: (anchor?.top ?? 0) + (anchor?.height ?? 23) + 4,
      left: Math.max(8, Math.min(anchor?.left ?? 8, node.clientWidth - 420)),
    });
  };
  const ordinaryCompletion = () =>
    Boolean(node.querySelector('.suggest-widget.visible')) ||
    Boolean(
      editor
        .getContribution<monaco.editor.IEditorContribution & { isInSnippet(): boolean }>(
          'snippetController2',
        )
        ?.isInSnippet(),
    );
  const safe = () => {
    const state = snapshot();
    return Boolean(
      state &&
      /\.tex$/i.test(state.document.path) &&
      !state.document.conflict &&
      !editor.getOption(monaco.editor.EditorOption.readOnly) &&
      !composing &&
      editor.getSelections()?.length === 1 &&
      !node.closest('.is-reviewing'),
    );
  };
  const valid = (request: AICompletionRequest) => {
    const state = snapshot();
    const model = editor.getModel();
    const position = editor.getPosition();
    return (
      safe() &&
      state?.document.projectId === request.projectId &&
      state.document.path === request.path &&
      model?.getVersionId() === request.modelVersion &&
      Boolean(position && model.getOffsetAt(position) === request.offset) &&
      editor.getSelection()?.isEmpty()
    );
  };
  function invalidate(dismiss = false) {
    generation++;
    clearTimeout(timer);
    clearTimeout(deadline);
    if (pending) void window.textra.cancelAICompletion({ requestId: pending });
    pending = null;
    if (dismiss && suggestion) {
      cache.delete(suggestion.key);
      dismissed.add(suggestion.key);
      if (dismissed.size > 64) dismissed.delete(dismissed.values().next().value!);
    }
    suggestion = null;
    manual = false;
    status = '';
    errorCode = undefined;
    editor.trigger('textra', 'editor.action.inlineSuggest.hide', {});
    view();
  }
  async function request(role: AICompletionRole) {
    const isManual = role === 'inlineCompletion';
    invalidate(isManual);
    if (!safe()) return;
    if (isManual) {
      editor.trigger('textra', 'hideSuggestWidget', {});
      editor.trigger('textra', 'leaveSnippet', {});
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) editor.setPosition(selection.getEndPosition());
    } else if (ordinaryCompletion() || !editor.hasTextFocus() || suspended) return;
    const state = snapshot();
    const model = editor.getModel();
    const position = editor.getPosition();
    if (!state || !model || !position || !editor.getSelection()?.isEmpty()) return;
    const ref = isManual ? state.manualModel : state.settings?.roleDefaults.completion;
    manual = isManual;
    if (!ref) {
      if (isManual) {
        status = 'Choose a Ctrl+I model in AI Settings.';
        view();
      }
      return;
    }
    const context = buildCompletionContext(model.getValue(), model.getOffsetAt(position), role);
    if (isLocalAIModel(ref)) {
      context.prefix = context.prefix.slice(isManual ? -4096 : -1024);
      context.suffix = context.suffix.slice(0, isManual ? 1024 : 256);
    }
    if (
      !isManual &&
      (!state.settings?.completion.enabled ||
        !sameModel(ref, state.settings.completion.consentedModel) ||
        context.cursor.excluded ||
        (!context.cursor.eligible && !state.settings.completion.allowOutsideEnvironments))
    )
      return;
    if (!isManual) {
      const unavailable = modelUnavailableReason(state.settings, ref, 'completion');
      if (unavailable) {
        status = unavailable;
        errorCode = 'AI_MODEL_UNAVAILABLE';
        view();
        return;
      }
    }
    const request: AICompletionRequest = {
      requestId: crypto.randomUUID(),
      role,
      model: ref,
      projectId: state.document.projectId,
      path: state.document.path,
      revision: state.document.revision,
      modelVersion: model.getVersionId(),
      offset: model.getOffsetAt(position),
      prefix: context.prefix,
      suffix: context.suffix,
      metadata: context.metadata,
    };
    const key = JSON.stringify([
      ref,
      request.projectId,
      request.path,
      request.offset,
      role,
      context.prefix,
      context.suffix,
      context.metadata,
    ]);
    const show = (text: string) => {
      suggestion = { request, text, key };
      status = '';
      // A cursor change can cancel Monaco's asynchronous rendering action.
      // This is normal invalidation, not an unhandled editor error.
      const action = editor.getAction?.('editor.action.inlineSuggest.trigger');
      if (action) void action.run().catch(() => undefined);
      view();
    };
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now() && !dismissed.has(key)) {
      show(cached.text);
      return;
    }
    if (!isManual && Date.now() - lastAutomatic < 2_000) return;
    if (!isManual) lastAutomatic = Date.now();
    pending = request.requestId;
    status = isManual ? 'Completing…' : 'AI completing…';
    view();
    const ticket = generation;
    deadline = setTimeout(
      () => {
        if (ticket !== generation) return;
        invalidate();
        if (isManual) {
          manual = true;
          status = 'Completion timed out. Regenerate to try again.';
          view();
        } else {
          status = isLocalAIModel(ref)
            ? 'Local AI timed out — try a smaller completion model.'
            : 'AI suggestion timed out';
          view();
        }
      },
      completionTimeout(role, ref),
    );
    try {
      const result = await window.textra.requestAICompletion(request);
      if (ticket !== generation || !valid(request)) return;
      clearTimeout(deadline);
      pending = null;
      if (!result.ok) {
        errorCode = result.code;
        if (!isManual && /auth|quota|rate.limit|API.key/i.test(`${result.code} ${result.error}`))
          suspended = true;
        status = isManual
          ? result.error
          : suspended
            ? 'AI suggestions paused — retry or change AI settings.'
            : 'AI suggestion unavailable';
        view();
        return;
      }
      if (
        result.value.requestId !== request.requestId ||
        result.value.modelVersion !== request.modelVersion ||
        result.value.offset !== request.offset ||
        !result.value.text.trim()
      ) {
        status = '';
        view();
        return;
      }
      cache.set(key, { text: result.value.text, expires: Date.now() + 30_000 });
      if (cache.size > 32) cache.delete(cache.keys().next().value!);
      show(result.value.text);
    } catch {
      if (ticket === generation) {
        clearTimeout(deadline);
        pending = null;
        status = isManual
          ? 'Completion failed. Regenerate to try again.'
          : 'AI suggestion unavailable';
        view();
      }
    }
  }
  function accept() {
    if (!suggestion || !valid(suggestion.request) || ordinaryCompletion()) return false;
    const item = suggestion;
    const model = editor.getModel()!;
    const position = model.getPositionAt(item.request.offset);
    invalidate(true);
    editor.pushUndoStop();
    const applied = editor.executeEdits('textra-ai-completion', [
      {
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column,
        ),
        text: item.text,
        forceMoveMarkers: true,
      },
    ]);
    editor.pushUndoStop();
    if (applied) editor.setPosition(model.getPositionAt(item.request.offset + item.text.length));
    editor.focus();
    return applied;
  }
  const provider = monaco.languages.registerInlineCompletionsProvider('latex', {
    provideInlineCompletions(model, position, context) {
      if (
        !suggestion ||
        model !== editor.getModel() ||
        context.selectedSuggestionInfo ||
        !valid(suggestion.request) ||
        ordinaryCompletion()
      )
        return { items: [] };
      // Monaco requires multiline ranges to reach EOL. Include the unchanged tail only
      // for rendering; acceptance always inserts the original continuation at the caret.
      const tail = model.getLineContent(position.lineNumber).slice(position.column - 1);
      return {
        items: [
          {
            insertText: suggestion.text + tail,
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              model.getLineMaxColumn(position.lineNumber),
            ),
          },
        ],
      };
    },
    disposeInlineCompletions() {},
  });
  const keydown = (event: KeyboardEvent) => {
    if (event.target && !node.contains(event.target as Node) && !editor.hasTextFocus()) return;
    if (event.key === 'Escape' && (manual || suggestion || pending)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      invalidate(true);
    } else if (
      event.key === 'Tab' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      suggestion &&
      valid(suggestion.request) &&
      !ordinaryCompletion()
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      accept();
    }
  };
  // Monaco consumes some shortcuts on its root before later root listeners run.
  // Capture at the document boundary, scoped strictly to this editor's targets.
  const keyboardTarget = node.ownerDocument ?? node;
  keyboardTarget.addEventListener('keydown', keydown as EventListener, true);
  const retryHealth = () => {
    suspended = false;
    invalidate();
  };
  window.addEventListener?.('textra-ai-completion-retry', retryHealth);
  const listeners = [
    editor.onDidChangeModelContent(() => {
      invalidate();
      queueMicrotask(() => {
        if (disposed) return;
        clearTimeout(timer);
        timer = setTimeout(() => void request('completion'), 750);
      });
    }),
    editor.onDidChangeCursorSelection(() => invalidate()),
    editor.onDidChangeModel(() => {
      invalidate();
      cache.clear();
      dismissed.clear();
    }),
    editor.onDidChangeConfiguration(() => {
      if (!safe()) invalidate();
    }),
    editor.onDidCompositionStart(() => {
      composing = true;
      invalidate();
    }),
    editor.onDidCompositionEnd(() => {
      composing = false;
    }),
    editor.onDidScrollChange(view),
  ];
  return {
    request: () => request('inlineCompletion'),
    accept,
    dismiss: () => invalidate(true),
    invalidate,
    configurationChanged: () => {
      suspended = false;
      invalidate();
      cache.clear();
    },
    retry: () => {
      suspended = false;
      invalidate();
    },
    dispose: () => {
      disposed = true;
      invalidate();
      provider.dispose();
      listeners.forEach((listener) => listener.dispose());
      keyboardTarget.removeEventListener('keydown', keydown as EventListener, true);
      window.removeEventListener?.('textra-ai-completion-retry', retryHealth);
      cache.clear();
      dismissed.clear();
    },
  };
}
