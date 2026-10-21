import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import type { Theme } from '../../../../shared/api';
import type { AIEditProposal } from '../../../../shared/ai';
import type { AIEditHunk } from '../../../../shared/ai-edits';
import './agent-inline-review.css';

interface Props {
  proposal: AIEditProposal;
  hunks: AIEditHunk[];
  onDecide: (id: string, decision: 'approved' | 'rejected') => void;
  invalidReason: string | null;
  busy: boolean;
  theme: Theme;
}

/** Disposable read-only snapshots; the live source editor stays mounted separately. */
export function AgentInlineReview({
  proposal,
  hunks,
  onDecide,
  invalidReason,
  busy,
  theme,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const diff = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const original = monaco.editor.createModel(proposal.content, 'latex');
    const modified = monaco.editor.createModel(proposal.modified, 'latex');
    const editor = monaco.editor.createDiffEditor(host.current, {
      editContext: false,
      readOnly: true,
      domReadOnly: true,
      ariaLabel: 'Read-only proposed changes',
      originalEditable: false,
      renderSideBySide: false,
      renderOverviewRuler: false,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      diffWordWrap: 'on',
    });
    editor.setModel({ original, modified });
    const firstLine = original.getPositionAt(hunks[0]?.start ?? 0).lineNumber;
    const focusFirstChange = editor.onDidUpdateDiff(() => {
      const change = editor.getLineChanges()?.[0];
      editor.getModifiedEditor().revealLineInCenter(change?.modifiedStartLineNumber || firstLine);
    });
    diff.current = editor;
    return () => {
      diff.current = null;
      focusFirstChange.dispose();
      editor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [proposal, hunks]);
  useEffect(() => {
    monaco.editor.setTheme(`textra-${theme}`);
  }, [theme]);
  const reveal = (hunk: AIEditHunk) => {
    const editor = diff.current;
    if (!editor) return;
    const line = editor.getOriginalEditor().getModel()?.getPositionAt(hunk.start).lineNumber ?? 1;
    editor.getOriginalEditor().revealLineInCenter(line);
    const change = editor
      .getLineChanges()
      ?.find((item) => item.originalStartLineNumber <= line && item.originalEndLineNumber >= line);
    editor.getModifiedEditor().revealLineInCenter(change?.modifiedStartLineNumber || line);
  };
  return (
    <section className="agent-inline-review" aria-label="Review agent changes">
      <header>
        <strong>Review agent changes</strong>
        <span>{proposal.path}</span>
      </header>
      {proposal.summary && <p className="agent-inline-summary">{proposal.summary}</p>}
      <p className="agent-inline-hint">
        Approve applies a change to your editor and advances to the next. Reject skips it.
      </p>
      {invalidReason && (
        <p role="status" className="agent-inline-notice">
          {invalidReason}
        </p>
      )}
      <div className="agent-inline-hunks" aria-label="Proposed changes">
        {hunks.map((hunk, index) => (
          <div key={hunk.id} className="agent-inline-hunk">
            <button type="button" className="agent-hunk-location" onClick={() => reveal(hunk)}>
              Change {index + 1} · line {proposal.content.slice(0, hunk.start).split('\n').length}
            </button>
            <span>Awaiting review</span>
            <button
              type="button"
              disabled={busy || !!invalidReason}
              onClick={() => onDecide(hunk.id, 'approved')}
              aria-label={`Approve change ${index + 1}`}
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busy || !!invalidReason}
              onClick={() => onDecide(hunk.id, 'rejected')}
              aria-label={`Reject change ${index + 1}`}
            >
              Reject
            </button>
          </div>
        ))}
      </div>
      <div className="agent-inline-diff" ref={host} aria-label="Read-only proposed changes" />
    </section>
  );
}

export function AgentReviewControls({
  total,
  busy,
  invalidReason,
  error,
  onApproveAll,
  onRejectAll,
}: {
  total: number;
  busy: boolean;
  invalidReason: string | null;
  error: string | null;
  onApproveAll: () => void;
  onRejectAll: () => void;
}) {
  return (
    <section className="agent-chat-review" aria-label="Agent review controls">
      <p>
        {total} {total === 1 ? 'change' : 'changes'} remaining
      </p>
      <div>
        <button type="button" disabled={busy || !!invalidReason} onClick={onApproveAll}>
          Approve all
        </button>
        <button type="button" disabled={busy} onClick={onRejectAll}>
          Reject all
        </button>
      </div>
      {invalidReason && <p role="status">{invalidReason}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
