import { useState, useRef, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ListChecks,
  NotePencil,
  Scroll,
  TextIndent,
  WarningCircle,
} from '../../icons';
import './writing.css';

/** One heading in the active document's source outline. Lines are one-based. */
export interface WritingOutlineItem {
  id: string;
  title: string;
  line: number;
  level: number;
}

/** A source annotation found while scanning the active document. Lines are one-based. */
export interface WritingTodoItem {
  id: string;
  line: number;
  kind: 'TODO' | 'FIXME';
  text: string;
}

/** Counts are intentionally supplied by the caller so the panel stays renderer-only. */
export interface WritingSummary {
  words: number;
  characters: number;
  sections: number;
  equations: number;
  figures: number;
  tables: number;
  citations: number;
  outline: WritingOutlineItem[];
  todos: WritingTodoItem[];
}

export interface WritingPanelProps {
  summary: WritingSummary;
  /** The active source line, used to highlight the containing outline heading. */
  activeLine: number | null;
  onJumpToLine: (line: number) => void;
  /** Opens a safe latexindent preview; the workspace owns formatting and applying changes. */
  onFormatDocument?: () => void;
  formatAvailable?: boolean;
}

function activeOutlineId(outline: WritingOutlineItem[], line: number | null): string | null {
  if (line === null || line < 1) return null;
  let active: WritingOutlineItem | undefined;
  for (const item of outline) {
    if (item.line <= line) active = item;
    else break;
  }
  return active?.id ?? null;
}

/**
 * Compact, source-agnostic writing utilities for an active LaTeX document.
 * Includes Outline and Notes in two collapsible, vertically-resizable panes.
 */
export function WritingPanel({
  summary,
  activeLine,
  onJumpToLine,
  onFormatDocument,
  formatAvailable = false,
}: WritingPanelProps) {
  const activeId = activeOutlineId(summary.outline, activeLine);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [notesHeight, setNotesHeight] = useState(130);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startY.current = e.clientY;
      startHeight.current = notesHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = startY.current - moveEvent.clientY;
        const newHeight = Math.max(70, Math.min(450, startHeight.current + delta));
        setNotesHeight(newHeight);
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [notesHeight],
  );

  return (
    <div className="writing-panel">
      <div className="sidebar-title writing-title">
        <span className="sidebar-heading">Writing</span>
        <div className="writing-header-actions">
          <button
            type="button"
            className="icon-button small writing-header-button"
            aria-label="Format document with latexindent"
            title={
              formatAvailable
                ? 'Format document with latexindent'
                : 'latexindent is not available. Install it to format LaTeX.'
            }
            disabled={!onFormatDocument || !formatAvailable}
            onClick={onFormatDocument}
          >
            <TextIndent size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="writing-content">
        {/* Section 1: Outline */}
        <section
          className={`writing-section writing-outline-section ${outlineOpen ? 'expanded' : 'collapsed'}`}
          aria-labelledby="writing-outline-heading"
          style={{
            flex: outlineOpen ? '1 1 0' : '0 0 32px',
            height: outlineOpen ? undefined : '32px',
            minHeight: outlineOpen ? '60px' : '32px',
          }}
        >
          <button
            type="button"
            className="writing-section-toggle"
            aria-expanded={outlineOpen}
            onClick={() => setOutlineOpen((open) => !open)}
          >
            {outlineOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span id="writing-outline-heading" className="writing-section-title-text">
              <Scroll size={13} aria-hidden="true" />
              Outline
            </span>
            <span className="writing-count">{summary.outline.length}</span>
          </button>

          {outlineOpen && (
            <div className="writing-section-body">
              {summary.outline.length === 0 ? (
                <p className="writing-empty">No section headings yet.</p>
              ) : (
                <ul className="writing-list">
                  {summary.outline.map((item) => {
                    const depth = Math.min(Math.max(0, item.level - 1), 4);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="writing-outline-item"
                          aria-current={item.id === activeId ? 'location' : undefined}
                          style={{ paddingLeft: 10 + depth * 12 }}
                          title={`Go to line ${item.line}`}
                          onClick={() => onJumpToLine(item.line)}
                        >
                          <span>{item.title}</span>
                          <small>Ln {item.line}</small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Resizer Splitter between Outline and Notes */}
        {outlineOpen && notesOpen && (
          <div
            className="writing-resizer"
            onMouseDown={onMouseDown}
            role="separator"
            aria-orientation="horizontal"
            title="Drag to resize Outline and Notes"
          />
        )}

        {/* Section 2: Notes */}
        <section
          className={`writing-section writing-todos-section ${notesOpen ? 'expanded' : 'collapsed'}`}
          aria-labelledby="writing-todos-heading"
          style={{
            height: notesOpen ? (outlineOpen ? `${notesHeight}px` : undefined) : '32px',
            flex: notesOpen ? (outlineOpen ? `0 0 ${notesHeight}px` : '1 1 0') : '0 0 32px',
            minHeight: notesOpen ? '60px' : '32px',
          }}
        >
          <button
            type="button"
            className="writing-section-toggle"
            aria-expanded={notesOpen}
            onClick={() => setNotesOpen((open) => !open)}
          >
            {notesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span id="writing-todos-heading" className="writing-section-title-text">
              <NotePencil size={13} aria-hidden="true" />
              Notes
            </span>
            <span className="writing-count">{summary.todos.length}</span>
          </button>

          {notesOpen && (
            <div className="writing-section-body">
              {summary.todos.length === 0 ? (
                <p className="writing-empty">No % TODO or % FIXME notes.</p>
              ) : (
                <ul className="writing-list">
                  {summary.todos.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="writing-todo-item"
                        title={`Go to ${item.kind} on line ${item.line}`}
                        onClick={() => onJumpToLine(item.line)}
                      >
                        {item.kind === 'TODO' && <ListChecks size={13} aria-hidden="true" />}
                        {item.kind === 'FIXME' && <WarningCircle size={13} aria-hidden="true" />}
                        <span className={'writing-tag ' + item.kind.toLowerCase()}>
                          {item.kind}
                        </span>
                        <span className="writing-todo-text">
                          {item.text || `${item.kind} on line ${item.line}`}
                        </span>
                        <small>Ln {item.line}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
