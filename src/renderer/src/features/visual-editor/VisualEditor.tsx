import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Editor, Extension, Node as TiptapNode, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { InlineMath, BlockMath } from '@tiptap/extension-mathematics';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import { Plugin } from '@tiptap/pm/state';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Button } from '../../components/Button';
import { DialogShell } from '../../components/DialogShell';
import {
  projectChanges,
  sourceOffsetForPosition,
  type Projection,
  type SourceEdit,
  type VisualNode,
} from './latex-adapter';
import './visual-editor.css';

export interface VisualViewState {
  anchor: number;
  head: number;
  scrollTop: number;
}

export interface VisualEditorHandle {
  format(request: { command: string; level?: number }): boolean;
  insertSource(text: string, caret: number): boolean;
  undo(): void;
  redo(): void;
  focus(): void;
  sourceSelection(): { anchor: number; head: number } | null;
  navigateSource(offset: number): boolean;
  getViewState(): VisualViewState | null;
  restoreViewState(state: VisualViewState): void;
}

export interface VisualEditorProps {
  projectId: string;
  path: string;
  lifetime: number;
  source: string;
  modelVersion: number;
  readOnly: boolean;
  visible: boolean;
  fontSize: number;
  initialViewState?: VisualViewState | null;
  apply(
    expectedVersion: number,
    edits: readonly SourceEdit[],
    group: 'typing' | 'command',
  ): number | null;
  undo(): void;
  redo(): void;
  onReady?(): void;
  onFailure?(message: string): void;
  onSwitchToCode?(sourceOffset?: number): void;
  onRecoveryChange?(hasDraft: boolean): void;
  onOpenReference?(target: string, command: string): void;
}

interface SourceDialog {
  id: string;
  version: number;
  from: number;
  to: number;
  original: string;
  open: string;
  close: string;
  equation: boolean;
  value: string;
  initialValue: string;
  baseSource: string;
}

interface ParseReply {
  generation: number;
  modelVersion: number;
  projection?: Projection;
  error?: string;
}

const recoveryDrafts = new Map<string, string>();

/** Editor coordinates are based on the same LF text used by the parser. */
function replaceSource(source: string, edits: readonly SourceEdit[]): string {
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.from - a.from))
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  return result;
}

export const VisualEditor = forwardRef<VisualEditorHandle, VisualEditorProps>(
  function VisualEditor(props, ref) {
    const propsRef = useRef(props);
    propsRef.current = props;
    const shell = useRef<HTMLDivElement>(null);
    const container = useRef<HTMLDivElement>(null);
    const editor = useRef<Editor | null>(null);
    const parser = useRef<Worker | null>(null);
    const generation = useRef(0);
    const projection = useRef<Projection | null>(null);
    const version = useRef(props.modelVersion);
    const replacing = useRef(false);
    const group = useRef<'typing' | 'command'>('typing');
    const requestParse = useRef<(source: string, modelVersion: number) => void>(() => {});
    const pendingCompositionParse = useRef<{ source: string; modelVersion: number } | null>(null);
    const recoveryKey = `${props.projectId}\0${props.path}\0${props.lifetime}`;
    const [notice, setNotice] = useState('');
    const [sourceDialog, setSourceDialog] = useState<SourceDialog | null>(null);
    const [recovery, setRecovery] = useState<string | null>(
      () => recoveryDrafts.get(recoveryKey) ?? null,
    );

    const requestSource = (id: string, equation = false, open = '', close = '') => {
      const current = projection.current;
      const range = current?.ranges[id];
      if (!current || !range) {
        setNotice('This source is no longer available. Try again after the editor refreshes.');
        return;
      }
      const original = current.source.slice(range.from, range.to);
      const hasDelimiters = equation && original.startsWith(open) && original.endsWith(close);
      const initialValue = hasDelimiters
        ? original.slice(open.length, original.length - close.length)
        : original;
      setSourceDialog({
        id,
        version: version.current,
        from: range.from,
        to: range.to,
        original,
        open: hasDelimiters ? open : '',
        close: hasDelimiters ? close : '',
        equation,
        value: initialValue,
        initialValue,
        baseSource: current.source,
      });
    };

    useEffect(() => {
      let disposed = false;
      const worker = new Worker(new URL('./visual-parser.worker.ts', import.meta.url), {
        type: 'module',
      });
      parser.current = worker;

      const openAtom = (id: string, equation = false, open = '', close = '') => {
        if (!disposed) requestSource(id, equation, open, close);
      };

      const sourceAtom = (name: 'opaqueInline' | 'opaqueBlock') =>
        TiptapNode.create({
          name,
          group: name === 'opaqueInline' ? 'inline' : 'block',
          inline: name === 'opaqueInline',
          atom: true,
          selectable: true,
          addAttributes() {
            return {
              sourceId: { default: '' },
              raw: { default: '' },
              label: { default: 'LaTeX source' },
            };
          },
          parseHTML() {
            return [];
          },
          renderHTML({ HTMLAttributes }) {
            return [name === 'opaqueInline' ? 'span' : 'div', HTMLAttributes];
          },
          addNodeView() {
            return ({ node }) => {
              const wrapper = document.createElement(name === 'opaqueInline' ? 'span' : 'div');
              wrapper.className = `visual-source-atom${name === 'opaqueBlock' ? ' is-block' : ''}`;
              wrapper.contentEditable = 'false';
              const label = document.createElement('span');
              label.className = 'visual-source-atom-label';
              label.textContent = String(node.attrs.label || 'LaTeX source');
              const button = document.createElement('button');
              button.type = 'button';
              button.textContent = 'Edit source';
              button.setAttribute('aria-label', `Edit source: ${label.textContent}`);
              button.addEventListener('click', () => openAtom(String(node.attrs.sourceId)));
              wrapper.append(label, button);
              const reference = /^\\(input|include|subfile|subfileinclude)\{([^{}\r\n]+)\}$/.exec(
                String(node.attrs.raw || ''),
              );
              if (reference) {
                const openFile = document.createElement('button');
                openFile.type = 'button';
                openFile.textContent = 'Open file';
                openFile.setAttribute('aria-label', `Open file: ${reference[2]}`);
                openFile.addEventListener('click', () =>
                  propsRef.current.onOpenReference?.(reference[2], reference[1]),
                );
                wrapper.append(openFile);
              }
              return {
                dom: wrapper,
                stopEvent: (event: Event) => event.target instanceof HTMLButtonElement,
              };
            };
          },
        });

      const mathNode = (block: boolean) =>
        (block ? BlockMath : InlineMath).extend({
          addNodeView() {
            return ({ node }) => {
              const element = document.createElement(block ? 'div' : 'span');
              element.className = `visual-math${block ? ' visual-math-block' : ''}`;
              element.contentEditable = 'false';
              element.setAttribute('role', 'button');
              element.setAttribute('tabindex', '0');
              element.setAttribute('aria-label', 'Edit equation');
              try {
                katex.render(String(node.attrs.latex || ''), element, {
                  displayMode: block,
                  throwOnError: true,
                  trust: false,
                  maxSize: 10,
                  maxExpand: 100,
                  macros: {},
                });
              } catch {
                element.textContent = 'Equation';
                element.classList.add('visual-math-error');
              }
              const activate = () =>
                openAtom(
                  String(node.attrs.sourceId),
                  true,
                  String(node.attrs.open || ''),
                  String(node.attrs.close || ''),
                );
              element.addEventListener('click', activate);
              element.addEventListener('keydown', (event) => {
                const keyboardEvent = event as KeyboardEvent;
                if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                  keyboardEvent.preventDefault();
                  activate();
                }
              });
              return { dom: element, stopEvent: (event: Event) => event.target === element };
            };
          },
        });

      const metadata = Extension.create({
        name: 'textraSourceMetadata',
        addGlobalAttributes() {
          return [
            {
              types: [
                'paragraph',
                'heading',
                'blockquote',
                'bulletList',
                'orderedList',
                'listItem',
                'inlineMath',
                'blockMath',
              ],
              attributes: { sourceId: { default: '' } },
            },
            {
              types: ['heading'],
              attributes: {
                latexCommand: { default: null },
                starred: { default: false },
                optionalTitle: { default: '' },
              },
            },
            { types: ['blockquote'], attributes: { latexEnvironment: { default: null } } },
            {
              types: ['inlineMath', 'blockMath'],
              attributes: { raw: { default: '' }, open: { default: '' }, close: { default: '' } },
            },
          ];
        },
      });

      const sync = Extension.create({
        name: 'textraSourceSync',
        priority: 1000,
        dispatchTransaction({ transaction, next }) {
          if (!transaction.docChanged || replacing.current) {
            next(transaction);
            return;
          }
          const current = projection.current;
          if (!current || propsRef.current.readOnly) return;
          // A split may inherit its parent's ID. Assign distinct IDs before comparing
          // the transaction with the original source projection.
          const ids = new Set<string>();
          transaction.doc.descendants((node, pos) => {
            if (!Object.hasOwn(node.attrs, 'sourceId')) return;
            const id = String(node.attrs.sourceId || '');
            if (!id || ids.has(id)) {
              const sourceId = `n-${crypto.randomUUID()}`;
              transaction.setNodeMarkup(pos, undefined, { ...node.attrs, sourceId });
              ids.add(sourceId);
            } else ids.add(id);
          });
          const result = projectChanges(current, transaction.doc.toJSON() as VisualNode);
          if (!result.ok) {
            setNotice(result.error);
            return;
          }
          const nextVersion = result.edits.length
            ? propsRef.current.apply(version.current, result.edits, group.current)
            : version.current;
          group.current = 'typing';
          if (nextVersion === null) {
            recoveryDrafts.set(recoveryKey, result.nextProjection.source);
            setRecovery(result.nextProjection.source);
            propsRef.current.onRecoveryChange?.(true);
            setNotice(
              'The document changed while this edit was being applied. Refresh and try again.',
            );
            requestParse.current(propsRef.current.source, propsRef.current.modelVersion);
            return;
          }
          version.current = nextVersion;
          projection.current = result.nextProjection;
          setNotice('');
          next(transaction);
        },
        addProseMirrorPlugins() {
          return [
            new Plugin({
              props: {
                handleKeyDown(_view, event) {
                  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
                  if (event.key.toLowerCase() === 'z') {
                    event.preventDefault();
                    if (event.shiftKey) propsRef.current.redo();
                    else propsRef.current.undo();
                    return true;
                  }
                  if (event.ctrlKey && event.key.toLowerCase() === 'y') {
                    event.preventDefault();
                    propsRef.current.redo();
                    return true;
                  }
                  return false;
                },
                handleDrop(_view, event) {
                  event.preventDefault();
                  return true;
                },
              },
            }),
          ];
        },
      });

      let pasting = false;
      const buildEditor = (initial: Projection) => {
        if (!container.current) return;
        const instance = new Editor({
          element: container.current,
          content: initial.doc as JSONContent,
          extensions: [
            StarterKit.configure({
              undoRedo: false,
              bold: false,
              italic: false,
              link: false,
              strike: false,
              underline: false,
              codeBlock: false,
              horizontalRule: false,
              trailingNode: false,
            }),
            Bold.extend({
              addKeyboardShortcuts() {
                return {};
              },
            }),
            Italic.extend({
              addKeyboardShortcuts() {
                return {};
              },
            }),
            metadata,
            sourceAtom('opaqueInline'),
            sourceAtom('opaqueBlock'),
            mathNode(false),
            mathNode(true),
            sync,
          ],
          enableInputRules: false,
          enablePasteRules: false,
          editable: !propsRef.current.readOnly,
          editorProps: {
            attributes: {
              'aria-label': 'Visual LaTeX editor',
              role: 'textbox',
              'aria-multiline': 'true',
            },
            handlePaste(view, event) {
              if (pasting) return false;
              const text = event.clipboardData?.getData('text/plain');
              event.preventDefault();
              if (!text) return true;
              pasting = true;
              group.current = 'command';
              try {
                view.pasteText(text);
              } finally {
                pasting = false;
              }
              return true;
            },
          },
        });
        editor.current = instance;
        const saved = propsRef.current.initialViewState;
        if (saved) {
          const max = instance.state.doc.content.size;
          instance.commands.setTextSelection({
            from: Math.min(saved.anchor, max),
            to: Math.min(saved.head, max),
          });
          if (shell.current) shell.current.scrollTop = saved.scrollTop;
        }
      };

      requestParse.current = (source, modelVersion) => {
        if (editor.current?.view.composing) {
          pendingCompositionParse.current = { source, modelVersion };
          return;
        }
        pendingCompositionParse.current = null;
        const parseGeneration = ++generation.current;
        editor.current?.setEditable(false);
        worker.postMessage({ generation: parseGeneration, source, modelVersion });
      };
      const acceptParse = (event: MessageEvent<ParseReply>) => {
        if (disposed || event.data.generation !== generation.current) return;
        if (editor.current?.view.composing) {
          pendingCompositionParse.current = {
            source: propsRef.current.source,
            modelVersion: propsRef.current.modelVersion,
          };
          return;
        }
        if (event.data.error || !event.data.projection) {
          propsRef.current.onFailure?.(event.data.error || 'Visual editor failed to load.');
          return;
        }
        const nextProjection = event.data.projection;
        if (
          nextProjection.source !== propsRef.current.source ||
          event.data.modelVersion !== propsRef.current.modelVersion
        )
          return;
        const previous = editor.current;
        const selection = previous?.state.selection;
        projection.current = nextProjection;
        version.current = propsRef.current.modelVersion;
        if (!previous) buildEditor(nextProjection);
        else {
          replacing.current = true;
          try {
            previous.commands.setContent(nextProjection.doc as JSONContent, { emitUpdate: false });
            if (selection) {
              const max = previous.state.doc.content.size;
              previous.commands.setTextSelection({
                from: Math.min(selection.anchor, max),
                to: Math.min(selection.head, max),
              });
            }
          } finally {
            replacing.current = false;
          }
          previous.setEditable(!propsRef.current.readOnly);
        }
        propsRef.current.onReady?.();
      };
      worker.onmessage = acceptParse;
      const finishComposition = () => {
        window.setTimeout(() => {
          const pending = pendingCompositionParse.current;
          if (!disposed && pending) requestParse.current(pending.source, pending.modelVersion);
        }, 0);
      };
      const editorContainer = container.current;
      editorContainer?.addEventListener('compositionend', finishComposition);
      worker.onerror = () => {
        if (!disposed)
          propsRef.current.onFailure?.('The visual editor could not prepare this document.');
      };
      requestParse.current(propsRef.current.source, propsRef.current.modelVersion);
      return () => {
        disposed = true;
        worker.terminate();
        editorContainer?.removeEventListener('compositionend', finishComposition);
        parser.current = null;
        editor.current?.destroy();
        editor.current = null;
        projection.current = null;
      };
    }, [props.projectId, props.path, props.lifetime, recoveryKey]);

    useEffect(() => {
      const current = projection.current;
      if (!current || current.source !== props.source) {
        requestParse.current(props.source, props.modelVersion);
      } else {
        version.current = props.modelVersion;
        editor.current?.setEditable(!props.readOnly);
        propsRef.current.onReady?.();
      }
    }, [props.source, props.modelVersion, props.readOnly]);

    const sourceOffsetAt = (position: number): number | null => {
      const instance = editor.current;
      const current = projection.current;
      if (!instance || !current) return null;
      const resolved = instance.state.doc.resolve(
        Math.max(0, Math.min(position, instance.state.doc.content.size)),
      );
      for (let depth = resolved.depth; depth >= 0; depth--) {
        const node = resolved.node(depth);
        const id = typeof node.attrs.sourceId === 'string' ? node.attrs.sourceId : '';
        if (!id || !current.ranges[id]) continue;
        const start = resolved.start(depth);
        let crossesAtom = false;
        instance.state.doc.nodesBetween(start, Math.max(start, position), (child) => {
          if (child.isAtom && !child.isText) crossesAtom = true;
        });
        if (crossesAtom) return null;
        const local = instance.state.doc.textBetween(start, Math.max(start, position), '\n');
        return sourceOffsetForPosition(current, id, local.length);
      }
      return null;
    };

    const insertTemplate = (kind: 'figure' | 'table'): boolean => {
      const instance = editor.current;
      const current = projection.current;
      if (!instance || !current || propsRef.current.readOnly) return false;
      const offset = sourceOffsetAt(instance.state.selection.head);
      const block =
        offset === null
          ? undefined
          : current.blocks.find(
              (item) =>
                item.from <= offset &&
                offset <= item.to &&
                !['opaqueBlock', 'blockMath'].includes(item.node.type),
            );
      if (!block) {
        setNotice('Place the cursor in editable text before inserting a figure or table.');
        return false;
      }
      const template =
        kind === 'figure'
          ? '\\begin{figure}[htbp]\n\t\\centering\n\t\n\t\\caption{}\n\t\\label{fig:}\n\\end{figure}'
          : '\\begin{table}[htbp]\n\t\\centering\n\t\\begin{tabular}{ll}\n\t\t\n\t\\end{tabular}\n\t\\caption{}\n\t\\label{tab:}\n\\end{table}';
      const edits = [{ from: block.to, to: block.to, insert: `\n\n${template}` }];
      const nextVersion = propsRef.current.apply(version.current, edits, 'command');
      if (nextVersion === null) {
        setNotice('The document changed before the block could be inserted. Try again.');
        return false;
      }
      version.current = nextVersion;
      requestParse.current(replaceSource(current.source, edits), nextVersion);
      return true;
    };

    useImperativeHandle(ref, () => ({
      format(request) {
        const instance = editor.current;
        if (!instance || propsRef.current.readOnly) return false;
        if (request.command === 'figure' || request.command === 'table')
          return insertTemplate(request.command);
        group.current = 'command';
        const chain = instance.chain().focus();
        switch (request.command) {
          case 'bold':
            return chain.toggleBold().run();
          case 'italic':
            return chain.toggleItalic().run();
          case 'itemize':
            return chain.toggleBulletList().run();
          case 'enumerate':
            return chain.toggleOrderedList().run();
          case 'heading':
            return chain
              .toggleHeading({
                level: Math.max(1, Math.min(5, request.level || 1)) as 1 | 2 | 3 | 4 | 5,
              })
              .run();
          default:
            group.current = 'typing';
            return false;
        }
      },
      insertSource(text, caret) {
        const instance = editor.current;
        const current = projection.current;
        if (!instance || !current || propsRef.current.readOnly) return false;
        let protectedSelection = false;
        instance.state.doc.nodesBetween(
          instance.state.selection.from,
          instance.state.selection.to,
          (node) => {
            if (['opaqueInline', 'opaqueBlock', 'inlineMath', 'blockMath'].includes(node.type.name))
              protectedSelection = true;
          },
        );
        if (protectedSelection) {
          setNotice('Edit protected source blocks separately before inserting source.');
          return false;
        }
        const anchor = sourceOffsetAt(instance.state.selection.anchor);
        const head = sourceOffsetAt(instance.state.selection.head);
        if (anchor === null || head === null) {
          setNotice('Open Code mode to insert source at this location.');
          return false;
        }
        const offset = Math.min(anchor, head);
        const edits = [{ from: offset, to: Math.max(anchor, head), insert: text }];
        const nextVersion = propsRef.current.apply(version.current, edits, 'command');
        if (nextVersion === null) return false;
        version.current = nextVersion;
        const nextSource = replaceSource(current.source, edits);
        requestParse.current(nextSource, nextVersion);
        propsRef.current.onSwitchToCode?.(offset + caret);
        return true;
      },
      undo() {
        propsRef.current.undo();
      },
      redo() {
        propsRef.current.redo();
      },
      focus() {
        editor.current?.commands.focus();
      },
      sourceSelection() {
        const selection = editor.current?.state.selection;
        if (!selection) return null;
        const anchor = sourceOffsetAt(selection.anchor);
        const head = sourceOffsetAt(selection.head);
        return anchor === null || head === null ? null : { anchor, head };
      },
      navigateSource(offset) {
        const instance = editor.current;
        const current = projection.current;
        if (!instance || !current) return false;
        let position: number | null = null;
        instance.state.doc.descendants((node, pos) => {
          if (!node.isTextblock) return;
          const id = typeof node.attrs.sourceId === 'string' ? node.attrs.sourceId : '';
          const range = current.ranges[id];
          if (!range || offset < range.from || offset > range.to) return;
          if (node.content.content.some((child) => child.isAtom && !child.isText)) return;
          let left = 0;
          let right = node.textContent.length;
          while (left < right) {
            const middle = Math.floor((left + right) / 2);
            if (sourceOffsetForPosition(current, id, middle) < offset) left = middle + 1;
            else right = middle;
          }
          if (sourceOffsetForPosition(current, id, left) === offset) position = pos + 1 + left;
        });
        if (position === null) return false;
        instance.commands.setTextSelection(position);
        instance.commands.focus();
        instance.commands.scrollIntoView();
        return true;
      },
      getViewState() {
        const selection = editor.current?.state.selection;
        if (!selection) return null;
        return {
          anchor: selection.anchor,
          head: selection.head,
          scrollTop: shell.current?.scrollTop ?? 0,
        };
      },
      restoreViewState(state) {
        const instance = editor.current;
        if (!instance) return;
        const max = instance.state.doc.content.size;
        instance.commands.setTextSelection({
          from: Math.min(state.anchor, max),
          to: Math.min(state.head, max),
        });
        if (shell.current) shell.current.scrollTop = state.scrollTop;
      },
    }));

    const applyDialog = () => {
      const current = projection.current;
      if (!sourceDialog || !current) return;
      const recoverDialogDraft = () => {
        const attempted = replaceSource(sourceDialog.baseSource, [
          {
            from: sourceDialog.from,
            to: sourceDialog.to,
            insert: `${sourceDialog.open}${sourceDialog.value}${sourceDialog.close}`,
          },
        ]);
        recoveryDrafts.set(recoveryKey, attempted);
        setRecovery(attempted);
        propsRef.current.onRecoveryChange?.(true);
        setSourceDialog(null);
      };
      const range = current.ranges[sourceDialog.id];
      if (
        version.current !== sourceDialog.version ||
        !range ||
        range.from !== sourceDialog.from ||
        range.to !== sourceDialog.to ||
        current.source.slice(range.from, range.to) !== sourceDialog.original
      ) {
        setNotice(
          'The source changed while this dialog was open. Copy your draft, then reopen it.',
        );
        recoverDialogDraft();
        return;
      }
      const edit = {
        from: range.from,
        to: range.to,
        insert: `${sourceDialog.open}${sourceDialog.value}${sourceDialog.close}`,
      };
      const nextVersion = propsRef.current.apply(version.current, [edit], 'command');
      if (nextVersion === null) {
        setNotice(
          'The source changed while this dialog was open. Copy your draft, then reopen it.',
        );
        recoverDialogDraft();
        return;
      }
      version.current = nextVersion;
      requestParse.current(replaceSource(current.source, [edit]), nextVersion);
      setSourceDialog(null);
      if (recovery === null) {
        recoveryDrafts.delete(recoveryKey);
        propsRef.current.onRecoveryChange?.(false);
      }
      setNotice('');
    };

    return (
      <>
        <div
          ref={shell}
          className="visual-editor-shell"
          data-testid="visual-editor"
          hidden={!props.visible}
          aria-hidden={!props.visible}
        >
          <div
            ref={container}
            className="visual-editor-content"
            style={{ fontSize: props.fontSize }}
          />
          {notice && (
            <div className="visual-editor-notice" role="status">
              {notice}
            </div>
          )}
          {recovery === null && sourceDialog === null && recoveryDrafts.has(recoveryKey) && (
            <div className="visual-editor-notice" role="status">
              A visual draft is waiting for recovery.{' '}
              <Button
                variant="toolbar"
                onClick={() => setRecovery(recoveryDrafts.get(recoveryKey) ?? null)}
              >
                Recover draft
              </Button>
            </div>
          )}
        </div>
        <DialogShell
          open={sourceDialog !== null}
          onOpenChange={(open) => {
            if (!open) {
              setSourceDialog(null);
              if (recovery === null) {
                recoveryDrafts.delete(recoveryKey);
                propsRef.current.onRecoveryChange?.(false);
              }
            }
          }}
          className="setup-dialog visual-source-dialog"
          title={sourceDialog?.equation ? 'Edit equation' : 'Edit LaTeX source'}
          description="Changes are applied to the open document. Save the file when you are ready."
          footer={
            <div className="dialog-actions">
              <Button
                onClick={() => {
                  setSourceDialog(null);
                  if (recovery === null) {
                    recoveryDrafts.delete(recoveryKey);
                    propsRef.current.onRecoveryChange?.(false);
                  }
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" disabled={props.readOnly} onClick={applyDialog}>
                Apply
              </Button>
            </div>
          }
        >
          {notice && (
            <p className="dialog-error" role="alert">
              {notice}
            </p>
          )}
          <textarea
            aria-label={sourceDialog?.equation ? 'Equation LaTeX' : 'LaTeX source'}
            value={sourceDialog?.value || ''}
            onChange={(event) => {
              const value = event.target.value;
              if (sourceDialog) {
                const changed = value !== sourceDialog.initialValue;
                if (changed)
                  recoveryDrafts.set(
                    recoveryKey,
                    replaceSource(sourceDialog.baseSource, [
                      {
                        from: sourceDialog.from,
                        to: sourceDialog.to,
                        insert: `${sourceDialog.open}${value}${sourceDialog.close}`,
                      },
                    ]),
                  );
                else if (recovery === null) recoveryDrafts.delete(recoveryKey);
                propsRef.current.onRecoveryChange?.(changed || recovery !== null);
              }
              setSourceDialog((current) => (current ? { ...current, value } : null));
            }}
            spellCheck={false}
          />
        </DialogShell>
        <DialogShell
          open={recovery !== null}
          onOpenChange={(open) => {
            if (!open) setRecovery(null);
          }}
          className="setup-dialog visual-source-dialog"
          title="Recover visual edit"
          description="The source changed while you were editing. Your attempted edit is preserved below; copy what you need before closing this dialog."
          footer={
            <div className="dialog-actions">
              <Button
                onClick={() => {
                  if (recovery !== null)
                    void navigator.clipboard
                      .writeText(recovery)
                      .catch(() => setNotice('Select and copy the draft text manually.'));
                }}
              >
                Copy draft
              </Button>
              <Button
                onClick={() => {
                  recoveryDrafts.delete(recoveryKey);
                  setRecovery(null);
                  propsRef.current.onRecoveryChange?.(false);
                }}
              >
                Discard draft
              </Button>
            </div>
          }
        >
          {notice && (
            <p className="dialog-error" role="status">
              {notice}
            </p>
          )}
          <textarea
            aria-label="Recovered LaTeX draft"
            value={recovery ?? ''}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </DialogShell>
      </>
    );
  },
);
