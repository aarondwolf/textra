import { AppTooltip } from '../../components/HelpTooltip';
import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import type { HistorySnapshotSummary } from '../../../../shared/api';
import { minimalEditorScrollbars } from '../editor/scrollbars';
import { Pin, ArrowSquareOut, Undo2, X, Pencil } from '../../icons';
import { Button, IconButton } from '../../components/Button';
import './history.css';

(self as typeof self & { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export interface HistoryDiffViewProps {
  document: { path: string; content: string };
  historicalSnapshot: HistorySnapshotSummary;
  historicalContent: string;
  theme: string;
  onClose: () => void;
  onRestore: () => Promise<void>;
  onExport: () => Promise<void>;
  onPin: (pinned: boolean, label?: string | null) => Promise<void>;
}

function getLanguage(path: string): string {
  if (/\.(tex|ltx|sty|cls|dtx)$/i.test(path)) return 'latex';
  if (/\.bib$/i.test(path)) return 'bibtex';
  if (/\.json$/i.test(path)) return 'json';
  if (/\.md$/i.test(path)) return 'markdown';
  return 'plaintext';
}

export function HistoryDiffView({
  document,
  historicalSnapshot,
  historicalContent,
  theme,
  onClose,
  onRestore,
  onExport,
  onPin,
}: HistoryDiffViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const original = useRef<monaco.editor.ITextModel | null>(null);
  const modified = useRef<monaco.editor.ITextModel | null>(null);
  const initialContent = useRef({
    documentContent: document.content,
    documentPath: document.path,
    historicalContent,
  });
  const [busy, setBusy] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(historicalSnapshot.label ?? '');

  useEffect(() => {
    setLabelDraft(historicalSnapshot.label ?? '');
  }, [historicalSnapshot.id, historicalSnapshot.label]);

  useEffect(() => {
    if (!host.current) return;
    const lang = getLanguage(initialContent.current.documentPath);

    original.current = monaco.editor.createModel(initialContent.current.historicalContent, lang);
    modified.current = monaco.editor.createModel(initialContent.current.documentContent, lang);

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
    original.current?.setValue(historicalContent);
  }, [historicalContent]);

  useEffect(() => {
    modified.current?.setValue(document.content);
  }, [document.content]);

  useEffect(() => {
    monaco.editor.setTheme(`textra-${theme}`);
  }, [theme]);

  const handleRestore = async () => {
    setBusy(true);
    try {
      await onRestore();
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      await onExport();
    } finally {
      setBusy(false);
    }
  };

  const handlePin = async () => {
    setBusy(true);
    try {
      await onPin(!historicalSnapshot.pinned, historicalSnapshot.label ?? '');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveLabel = async () => {
    setBusy(true);
    try {
      await onPin(true, labelDraft.trim() || null);
      setEditingLabel(false);
    } finally {
      setBusy(false);
    }
  };

  const dateFormatted = new Date(historicalSnapshot.createdAt).toLocaleString();

  return (
    <section className="history-diff" aria-label="Historical snapshot comparison">
      <header className="history-diff-header">
        <div>
          <h2>History Comparison: {historicalSnapshot.path}</h2>
          <p>
            Historical snapshot from {dateFormatted} ({historicalSnapshot.trigger} trigger)
            {historicalSnapshot.label ? (
              <>
                {' • '}
                <span className="history-diff-header-label">{historicalSnapshot.label}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="history-diff-actions">
          {editingLabel ? (
            <form
              className="history-diff-label-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveLabel();
              }}
            >
              <input
                aria-label="Snapshot label"
                autoFocus
                value={labelDraft}
                placeholder="Snapshot label"
                onChange={(event) => setLabelDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setEditingLabel(false);
                }}
                disabled={busy}
              />
              <Button variant="primary" type="submit" disabled={busy}>
                Save label
              </Button>
              <IconButton
                label="Cancel label edit"
                className="exit-diff-btn"
                onClick={() => setEditingLabel(false)}
                disabled={busy}
              >
                <X size={14} />
              </IconButton>
            </form>
          ) : (
            <Button
              aria-label={historicalSnapshot.label ? 'Edit snapshot label' : 'Add snapshot label'}
              title={historicalSnapshot.label ? 'Edit snapshot label' : 'Add snapshot label'}
              onClick={() => {
                setLabelDraft(historicalSnapshot.label ?? '');
                setEditingLabel(true);
              }}
              disabled={busy}
            >
              <Pencil size={13} />
              {historicalSnapshot.label ? 'Edit label' : 'Add label'}
            </Button>
          )}
          <AppTooltip
            content={historicalSnapshot.pinned ? 'Unpin this snapshot' : 'Pin this snapshot'}
          >
            <span className="tooltip-disabled-trigger">
              <button
                type="button"
                className={historicalSnapshot.pinned ? 'is-pinned' : ''}

                aria-label={historicalSnapshot.pinned ? 'Unpin this snapshot' : 'Pin this snapshot'}
                onClick={() => void handlePin()}
                disabled={busy}
              >
                <Pin size={13} weight={historicalSnapshot.pinned ? 'fill' : 'regular'} />
                {historicalSnapshot.pinned ? 'Pinned' : 'Pin'}
              </button>
            </span>
          </AppTooltip>
          <AppTooltip content={'Export snapshot to an external file'}>
            <span className="tooltip-disabled-trigger">
              <button
                type="button"

                aria-label="Export snapshot to an external file"
                onClick={() => void handleExport()}
                disabled={busy}
              >
                <ArrowSquareOut size={13} />
                Export
              </button>
            </span>
          </AppTooltip>
          <AppTooltip content={'Restore this version (replaces current file on disk)'}>
            <span className="tooltip-disabled-trigger">
              <button
                type="button"
                className="restore-btn"

                aria-label="Restore this version (replaces current file on disk)"
                onClick={() => void handleRestore()}
                disabled={busy}
              >
                <Undo2 size={13} />
                Restore version
              </button>
            </span>
          </AppTooltip>
          <AppTooltip content={'Exit history comparison'}>
            <button
              type="button"
              className="exit-diff-btn icon-button small"
              aria-label="Exit history comparison"

              onClick={onClose}
            >
              <X size={15} />
            </button>
          </AppTooltip>
        </div>
      </header>

      <div className="history-diff-labels">
        <span>
          Historical Snapshot ({dateFormatted}) [{historicalSnapshot.trigger}]
        </span>
        <span>Current Working Copy ({document.path})</span>
      </div>

      <div ref={host} className="history-diff-editor" />
    </section>
  );
}
