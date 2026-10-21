import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import type { ConflictDiffData } from './types';
import { minimalEditorScrollbars } from '../editor/scrollbars';
import './conflicts.css';

(self as typeof self & { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export interface ConflictDiffViewProps extends ConflictDiffData {
  onClose: () => void;
}

/** A disposable, read-only Monaco comparison for an external edit conflict. */
export function ConflictDiffView({
  document,
  externalContent,
  external,
  snapshotPath,
  theme,
  onClose,
}: ConflictDiffViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const original = useRef<monaco.editor.ITextModel | null>(null);
  const modified = useRef<monaco.editor.ITextModel | null>(null);
  const initialContent = useRef({ documentContent: document.content, externalContent });

  useEffect(() => {
    if (!host.current) return;
    original.current = monaco.editor.createModel(
      initialContent.current.documentContent,
      'plaintext',
    );
    modified.current = monaco.editor.createModel(
      initialContent.current.externalContent ?? '',
      'plaintext',
    );
    editor.current = monaco.editor.createDiffEditor(host.current, {
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      renderOverviewRuler: false,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollbar: minimalEditorScrollbars,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      lineNumbers: 'on',
      diffWordWrap: 'on',
    });
    editor.current.setModel({ original: original.current, modified: modified.current });
    return () => {
      editor.current?.dispose();
      editor.current = null;
      original.current?.dispose();
      original.current = null;
      modified.current?.dispose();
      modified.current = null;
    };
  }, []);

  useEffect(() => {
    original.current?.setValue(document.content);
  }, [document.content]);
  useEffect(() => {
    modified.current?.setValue(externalContent ?? '');
  }, [externalContent]);
  useEffect(() => {
    monaco.editor.setTheme(`textra-${theme}`);
  }, [theme]);

  const unstable = external.state !== 'stable';
  return (
    <section className="conflict-diff" aria-label="External-change comparison">
      <header className="conflict-diff-header">
        <div>
          <h2>Conflict comparison</h2>
          <p>Read-only — merging and manual resolution are not available here.</p>
        </div>
        <div className="conflict-diff-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Close comparison"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      {unstable && (
        <div className="conflict-diff-warning" role="status">
          <span className="conflict-orbit" aria-hidden="true" />
          The external side may still be changing. Wait until it settles before relying on this
          view.
        </div>
      )}
      <div className="conflict-diff-labels" aria-hidden="true">
        <span>{snapshotPath ?? 'TeXtra in-memory buffer'}</span>
        <span>{externalContent === null ? 'External file unavailable' : document.path}</span>
      </div>
      <div className="conflict-diff-editor" ref={host} />
    </section>
  );
}
