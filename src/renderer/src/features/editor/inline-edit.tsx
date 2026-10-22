import { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import type { AISettings } from '../../../../shared/api';
import type { AIModelRef, AIInlineEditRequest } from '../../../../shared/ai';
import { buildCompletionContext } from '../../../../shared/latex-completion';
import type { OpenDocument } from '../../state/workspace';
import { ModelPicker } from '../chat/ModelPicker';
import { modelUnavailableReason } from '../chat/useAISettings';

interface InlineSnapshot {
  document: OpenDocument;
  settings: AISettings | null;
  model: AIModelRef | null;
}
interface Anchor {
  model: monaco.editor.ITextModel;
  selection: monaco.Selection;
  offset: number;
  endOffset: number;
  version: number;
  projectId: string;
  path: string;
  revision: string;
}
interface PromptProps {
  settings: AISettings | null;
  model: AIModelRef | null;
  instruction: string;
  status: string;
  loading: boolean;
  blocked: boolean;
  replacement: string | null;
  original: string;
  onInstruction(value: string): void;
  onModel(value: AIModelRef): void;
  generate(): void;
  accept(): void;
  close(): void;
  resize(height: number): void;
}

function InlinePrompt(props: PromptProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const card = useRef<HTMLElement>(null);
  const focusPending = useRef(true);
  const resize = props.resize;
  useEffect(() => {
    const element = card.current;
    if (!element) return;
    const measure = () => {
      const height = element.getBoundingClientRect().height;
      if (!height) return;
      resize(height + 16);
      if (focusPending.current) {
        focusPending.current = false;
        input.current?.focus({ preventScroll: true });
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const frame = requestAnimationFrame(measure);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [resize]);
  return (
    <section
      ref={card}
      className="ai-inline-prompt"
      aria-label="Inline AI edit"
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          props.close();
        }
      }}
    >
      <textarea
        ref={input}
        aria-label="Inline edit instruction"
        placeholder="Describe the change or text to insert…"
        rows={2}
        maxLength={4000}
        value={props.instruction}
        onChange={(event) => props.onInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            props.generate();
          }
        }}
      />
      <div className="ai-inline-actions">
        <ModelPicker
          settings={props.settings}
          value={props.model}
          role="inlineCompletion"
          label="Inline edit model"
          variant="compact"
          onChange={props.onModel}
        />
        <span role="status">{props.status}</span>
        <button
          type="button"
          disabled={props.loading || props.blocked || !props.instruction.trim() || !props.model}
          onClick={props.generate}
        >
          {props.loading ? 'Generating…' : props.replacement === null ? 'Generate' : 'Regenerate'}
        </button>
        {props.replacement !== null && (
          <button type="button" onClick={props.accept}>
            Accept
          </button>
        )}
        <button type="button" onClick={props.close}>
          Cancel
        </button>
      </div>
      {props.replacement !== null && props.original && (
        <div className="ai-inline-diff" aria-label="Inline edit preview">
          <del>{props.original}</del>
          <ins>{props.replacement}</ins>
        </div>
      )}
    </section>
  );
}

/** Prompted selection edits and insertions. An anchor survives prompt/picker focus. */
export function installInlineEdit(
  editor: monaco.editor.IStandaloneCodeEditor,
  snapshot: () => InlineSnapshot | null,
  selectModel: (ref: AIModelRef) => void,
  dismissAutomatic: () => void,
) {
  let anchor: Anchor | null = null;
  let zone: string | null = null;
  let zoneLayout: monaco.editor.IViewZone | null = null;
  let zoneContainer: HTMLElement | null = null;
  let previousAriaHidden: string | null = null;
  let previousZoneZIndex = '';
  let root: Root | null = null;
  let promptHost: HTMLDivElement | null = null;
  let instruction = '';
  let status = '';
  let replacement: string | null = null;
  let pending: string | null = null;
  let generation = 0;
  let composing = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const node = editor.getDomNode()!;
  const keyboardTarget = node.ownerDocument ?? node;
  const safe = () => {
    const state = snapshot();
    return Boolean(
      state &&
      /\.tex$/i.test(state.document.path) &&
      !state.document.conflict &&
      !editor.getOption(monaco.editor.EditorOption.readOnly) &&
      editor.getSelections()?.length === 1 &&
      !composing &&
      !node.closest('.is-reviewing'),
    );
  };
  const valid = () => {
    const state = snapshot();
    const selection = editor.getSelection();
    return Boolean(
      anchor &&
      safe() &&
      editor.getModel() === anchor.model &&
      anchor.model.getVersionId() === anchor.version &&
      state?.document.projectId === anchor.projectId &&
      state.document.path === anchor.path &&
      selection &&
      monaco.Selection.selectionsEqual(selection, anchor.selection),
    );
  };
  function cancelPending() {
    generation++;
    clearTimeout(deadline);
    if (pending) void window.textra.cancelAIInlineEdit({ requestId: pending });
    pending = null;
  }
  function close(focus = true) {
    cancelPending();
    anchor = null;
    replacement = null;
    status = '';
    editor.trigger('textra', 'editor.action.inlineSuggest.hide', {});
    if (zone) editor.changeViewZones((accessor) => accessor.removeZone(zone!));
    zone = null;
    zoneLayout = null;
    if (zoneContainer) {
      zoneContainer.style.zIndex = previousZoneZIndex;
      if (previousAriaHidden === null) zoneContainer.removeAttribute('aria-hidden');
      else zoneContainer.setAttribute('aria-hidden', previousAriaHidden);
    }
    zoneContainer = null;
    const previous = root;
    root = null;
    promptHost = null;
    if (previous) queueMicrotask(() => previous.unmount());
    if (focus) editor.focus();
  }
  function render() {
    if (!root || !anchor) return;
    const state = snapshot();
    const oversized = anchor.endOffset - anchor.offset > 16_000;
    root.render(
      <InlinePrompt
        settings={state?.settings ?? null}
        model={state?.model ?? null}
        instruction={instruction}
        status={oversized ? 'Select 16,000 characters or fewer for an inline edit.' : status}
        loading={Boolean(pending)}
        blocked={oversized}
        replacement={replacement}
        original={oversized ? '' : anchor.model.getValueInRange(anchor.selection)}
        onInstruction={(value) => {
          cancelPending();
          replacement = null;
          status = '';
          instruction = value;
          render();
        }}
        onModel={(ref) => {
          cancelPending();
          replacement = null;
          status = '';
          editor.trigger('textra', 'editor.action.inlineSuggest.hide', {});
          selectModel(ref);
          render();
        }}
        generate={() => void generate()}
        accept={accept}
        close={() => close()}
        resize={(height) => {
          if (!zone || !zoneLayout) return;
          const measured = Math.ceil(height);
          if (zoneLayout.heightInPx === measured) return;
          zoneLayout.heightInPx = measured;
          editor.changeViewZones((accessor) => accessor.layoutZone(zone!));
        }}
      />,
    );
  }
  function open() {
    if (!safe()) return;
    if (anchor && valid() && promptHost) {
      promptHost.querySelector('textarea')?.focus({ preventScroll: true });
      return;
    }
    dismissAutomatic();
    close(false);
    editor.trigger('textra', 'hideSuggestWidget', {});
    editor.trigger('textra', 'leaveSnippet', {});
    const model = editor.getModel();
    const selection = editor.getSelection();
    const state = snapshot();
    if (!model || !selection || !state) return;
    const start = model.getOffsetAt(selection.getStartPosition());
    const end = model.getOffsetAt(selection.getEndPosition());
    anchor = {
      model,
      selection,
      offset: start,
      endOffset: end,
      version: model.getVersionId(),
      projectId: state.document.projectId,
      path: state.document.path,
      revision: state.document.revision,
    };
    instruction = '';
    status = '';
    replacement = null;
    const host = document.createElement('div');
    promptHost = host;
    host.className = 'ai-inline-zone';
    root = createRoot(host);
    editor.changeViewZones((accessor) => {
      zoneLayout = {
        afterLineNumber: selection.endLineNumber,
        heightInPx: 170,
        domNode: host,
        suppressMouseDown: false,
      };
      zone = accessor.addZone(zoneLayout);
    });
    // Monaco hides decorative view zones from assistive technology by default.
    // This zone contains an interactive form, so expose it while it is mounted.
    zoneContainer = host.closest('.view-zones');
    if (zoneContainer) {
      previousZoneZIndex = zoneContainer.style.zIndex;
      zoneContainer.style.zIndex = '10';
      previousAriaHidden = zoneContainer.getAttribute('aria-hidden');
      zoneContainer.removeAttribute('aria-hidden');
    }
    render();
    editor.revealLineInCenter(selection.endLineNumber);
  }
  async function generate() {
    if (!valid() || !anchor || !instruction.trim() || pending) return;
    if (anchor.endOffset - anchor.offset > 16_000) return;
    const state = snapshot();
    if (!state?.model) {
      status = 'Choose an inline edit model.';
      render();
      return;
    }
    const unavailable = modelUnavailableReason(state.settings, state.model, 'inlineCompletion');
    if (unavailable) {
      status = unavailable;
      render();
      return;
    }
    cancelPending();
    replacement = null;
    editor.trigger('textra', 'editor.action.inlineSuggest.hide', {});
    const source = anchor.model.getValue();
    const context = buildCompletionContext(source, anchor.offset, 'inlineCompletion');
    const request: AIInlineEditRequest = {
      requestId: crypto.randomUUID(),
      model: state.model,
      projectId: anchor.projectId,
      path: anchor.path,
      revision: state.document.revision,
      modelVersion: anchor.version,
      offset: anchor.offset,
      endOffset: anchor.endOffset,
      prefix: context.prefix,
      suffix: source.slice(anchor.endOffset, anchor.endOffset + 4_000),
      metadata: context.metadata,
      selection: source.slice(anchor.offset, anchor.endOffset),
      instruction: instruction.trim(),
    };
    const ticket = generation;
    pending = request.requestId;
    status = 'Generating…';
    render();
    deadline = setTimeout(() => {
      if (ticket === generation) {
        cancelPending();
        status = 'Inline edit timed out. Generate to try again.';
        render();
      }
    }, 60_000);
    try {
      const result = await window.textra.requestAIInlineEdit(request);
      if (ticket !== generation || !valid()) return;
      clearTimeout(deadline);
      pending = null;
      if (!result.ok) {
        status = result.error;
        render();
        return;
      }
      const response = result.value;
      if (
        response.requestId !== request.requestId ||
        response.modelVersion !== request.modelVersion ||
        response.offset !== request.offset ||
        response.endOffset !== request.endOffset
      ) {
        status = 'The edit response was stale.';
        render();
        return;
      }
      replacement = response.text;
      status = 'Review before accepting.';
      render();
      if (!request.selection) {
        editor.focus();
        const action = editor.getAction('editor.action.inlineSuggest.trigger');
        if (action) void action.run().catch(() => undefined);
      }
    } catch {
      if (ticket === generation) {
        clearTimeout(deadline);
        pending = null;
        status = 'Inline edit failed. Generate to try again.';
        render();
      }
    }
  }
  function accept() {
    if (!valid() || !anchor || replacement === null) return false;
    const captured = anchor;
    const text = replacement;
    close(false);
    editor.pushUndoStop();
    const applied = editor.executeEdits('textra-ai-inline-edit', [
      { range: captured.selection, text, forceMoveMarkers: true },
    ]);
    editor.pushUndoStop();
    if (applied) editor.setPosition(captured.model.getPositionAt(captured.offset + text.length));
    editor.focus();
    return applied;
  }
  const provider = monaco.languages.registerInlineCompletionsProvider('latex', {
    provideInlineCompletions(model, position) {
      if (
        !anchor ||
        replacement === null ||
        anchor.offset !== anchor.endOffset ||
        model !== anchor.model ||
        !valid()
      )
        return { items: [] };
      const tail = model.getLineContent(position.lineNumber).slice(position.column - 1);
      return {
        items: [
          {
            insertText: replacement + tail,
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
  const keydown = (event: Event) => {
    const key = event as KeyboardEvent;
    if ((key.target as HTMLElement | null)?.closest?.('.ai-inline-prompt')) return;
    if (!editor.hasTextFocus()) return;
    if (key.ctrlKey && !key.altKey && !key.shiftKey && key.key.toLowerCase() === 'i') {
      key.preventDefault();
      key.stopImmediatePropagation();
      open();
    } else if (key.ctrlKey && !key.altKey && !key.shiftKey && key.key === 'Enter') {
      key.preventDefault();
      key.stopImmediatePropagation();
      window.dispatchEvent(new CustomEvent('textra:compile'));
    } else if (anchor && key.key === 'Escape') {
      key.preventDefault();
      key.stopImmediatePropagation();
      close();
    } else if (
      anchor &&
      replacement !== null &&
      anchor.offset === anchor.endOffset &&
      key.key === 'Tab' &&
      !key.shiftKey &&
      !node.querySelector('.suggest-widget.visible')
    ) {
      key.preventDefault();
      key.stopImmediatePropagation();
      accept();
    }
  };
  keyboardTarget.addEventListener('keydown', keydown, true);
  const openAction = editor.addAction({
    id: 'textra.inlineEdit',
    label: 'TeXtra: Inline AI edit',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
    precondition: 'editorTextFocus',
    run: () => open(),
  });
  const compileAction = editor.addAction({
    id: 'textra.compileSource',
    label: 'TeXtra: Compile document',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
    precondition: 'editorTextFocus',
    run: () => {
      window.dispatchEvent(new CustomEvent('textra:compile'));
    },
  });
  const listeners = [
    editor.onDidChangeModelContent(() => close(false)),
    editor.onDidChangeModel(() => close(false)),
    editor.onDidChangeCursorSelection(() => {
      if (anchor && !valid()) close(false);
    }),
    editor.onDidCompositionStart(() => {
      composing = true;
      close(false);
    }),
    editor.onDidCompositionEnd(() => {
      composing = false;
    }),
  ];
  return {
    open,
    accept,
    close,
    configurationChanged: () => {
      if (anchor) {
        cancelPending();
        replacement = null;
        status = '';
        render();
      }
    },
    invalidate: () => close(false),
    dispose: () => {
      close(false);
      provider.dispose();
      openAction.dispose();
      compileAction.dispose();
      listeners.forEach((item) => item.dispose());
      keyboardTarget.removeEventListener('keydown', keydown, true);
    },
  };
}
