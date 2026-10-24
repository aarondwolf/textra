import { useState, useRef, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
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
  /** Reorders a section in the document source by moving it before or after another section. */
  onMoveSection?: (fromIndex: number, toIndex: number, position: 'before' | 'after') => void;
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
  onMoveSection,
}: WritingPanelProps) {
  const activeId = activeOutlineId(summary.outline, activeLine);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [notesHeight, setNotesHeight] = useState(130);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    position: 'before' | 'after';
  } | null>(null);
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
                  {summary.outline.map((item, index) => {
                    const depth = Math.min(Math.max(0, item.level - 1), 4);
                    const isDropBefore =
                      dropTarget?.index === index && dropTarget.position === 'before';
                    const isDropAfter =
                      dropTarget?.index === index && dropTarget.position === 'after';
                    const isDraggingItem = draggedIndex === index;

                    return (
                      <li
                        key={item.id}
                        className={`writing-outline-row ${isDraggingItem ? 'is-dragging' : ''} ${isDropBefore ? 'drop-before' : ''} ${isDropAfter ? 'drop-after' : ''}`}
                        draggable={Boolean(onMoveSection)}
                        onDragStart={(e) => {
                          if (!onMoveSection) return;
                          e.dataTransfer.setData('text/plain', String(index));
                          e.dataTransfer.effectAllowed = 'move';
                          setDraggedIndex(index);
                        }}
                        onDragOver={(e) => {
                          if (!onMoveSection || draggedIndex === null || draggedIndex === index)
                            return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          const rect = e.currentTarget.getBoundingClientRect();
                          const midY = rect.top + rect.height / 2;
                          const position = e.clientY < midY ? 'before' : 'after';
                          if (dropTarget?.index !== index || dropTarget?.position !== position) {
                            setDropTarget({ index, position });
                          }
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            if (dropTarget?.index === index) setDropTarget(null);
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (onMoveSection && draggedIndex !== null && dropTarget) {
                            onMoveSection(draggedIndex, dropTarget.index, dropTarget.position);
                          }
                          setDraggedIndex(null);
                          setDropTarget(null);
                        }}
                        onDragEnd={() => {
                          setDraggedIndex(null);
                          setDropTarget(null);
                        }}
                      >
                        <button
                          type="button"
                          className="writing-outline-item"
                          aria-current={item.id === activeId ? 'location' : undefined}
                          style={{ paddingLeft: 10 + depth * 12 }}
                          title={`Go to line ${item.line}${onMoveSection ? ' (drag to reorder)' : ''}`}
                          onClick={() => onJumpToLine(item.line)}
                        >
                          <span>{item.title}</span>
                          <small className="writing-outline-line">Ln {item.line}</small>
                        </button>
                        {onMoveSection && (
                          <div
                            className="writing-outline-actions"
                            role="group"
                            aria-label="Reorder section"
                          >
                            <button
                              type="button"
                              className="writing-outline-action-button"
                              title="Move section up"
                              aria-label="Move section up"
                              disabled={index === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                onMoveSection(index, index - 1, 'before');
                              }}
                            >
                              <ChevronUp size={11} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="writing-outline-action-button"
                              title="Move section down"
                              aria-label="Move section down"
                              disabled={index === summary.outline.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                onMoveSection(index, index + 1, 'after');
                              }}
                            >
                              <ChevronDown size={11} aria-hidden="true" />
                            </button>
                          </div>
                        )}
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
            aria-label="Notes height"
            aria-orientation="horizontal"
            aria-valuemin={70}
            aria-valuemax={450}
            aria-valuenow={notesHeight}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setNotesHeight((prev) => Math.min(450, prev + 16));
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setNotesHeight((prev) => Math.max(70, prev - 16));
              } else if (e.key === 'Home') {
                e.preventDefault();
                setNotesHeight(70);
              } else if (e.key === 'End') {
                e.preventDefault();
                setNotesHeight(450);
              }
            }}
            onDoubleClick={() => setNotesHeight(130)}
            title="Drag or use arrow keys to resize Outline and Notes"
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
                        className={`writing-todo-item is-${item.kind.toLowerCase()}`}
                        title={`Go to ${item.kind} on line ${item.line}`}
                        onClick={() => onJumpToLine(item.line)}
                      >
                        {item.kind === 'TODO' && (
                          <ListChecks className="todo-icon" size={13} aria-hidden="true" />
                        )}
                        {item.kind === 'FIXME' && (
                          <WarningCircle className="fixme-icon" size={13} aria-hidden="true" />
                        )}
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
