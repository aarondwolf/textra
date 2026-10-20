import { Article, Check, LocateFixed, Scroll, WarningCircle } from '../../icons';
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
  focusMode: boolean;
  onJumpToLine: (line: number) => void;
  onToggleFocusMode: () => void;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(Math.max(0, value));
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
 * Compact, source-agnostic writing utilities for an active LaTex document.
 * Parsing and editor navigation are deliberately injected by the workspace.
 */
export function WritingPanel({
  summary,
  activeLine,
  focusMode,
  onJumpToLine,
  onToggleFocusMode,
}: WritingPanelProps) {
  const activeId = activeOutlineId(summary.outline, activeLine);

  return (
    <div className="writing-panel">
      <div className="sidebar-title writing-title">
        <span className="sidebar-heading">Writing</span>
        <button
          type="button"
          className={'writing-focus-button' + (focusMode ? ' active' : '')}
          aria-pressed={focusMode}
          title={focusMode ? 'Leave focus mode' : 'Enter focus mode'}
          onClick={onToggleFocusMode}
        >
          <LocateFixed size={14} aria-hidden="true" />
          <span>{focusMode ? 'Focus on' : 'Focus'}</span>
        </button>
      </div>

      <section className="writing-section" aria-labelledby="writing-stats-heading">
        <h3 id="writing-stats-heading" className="writing-section-title">
          <Article size={14} aria-hidden="true" />
          Document
        </h3>
        <dl className="writing-stats">
          <div>
            <dt>Words</dt>
            <dd>{formatNumber(summary.words)}</dd>
          </div>
          <div>
            <dt>Characters</dt>
            <dd>{formatNumber(summary.characters)}</dd>
          </div>
          <div>
            <dt>Sections</dt>
            <dd>{formatNumber(summary.sections)}</dd>
          </div>
          <div>
            <dt>Equations</dt>
            <dd>{formatNumber(summary.equations)}</dd>
          </div>
          <div>
            <dt>Figures</dt>
            <dd>{formatNumber(summary.figures)}</dd>
          </div>
          <div>
            <dt>Tables</dt>
            <dd>{formatNumber(summary.tables)}</dd>
          </div>
          <div>
            <dt>Citations</dt>
            <dd>{formatNumber(summary.citations)}</dd>
          </div>
        </dl>
      </section>

      <section
        className="writing-section writing-outline-section"
        aria-labelledby="writing-outline-heading"
      >
        <h3 id="writing-outline-heading" className="writing-section-title">
          <Scroll size={14} aria-hidden="true" />
          Outline
          <span className="writing-count">{summary.outline.length}</span>
        </h3>
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
      </section>

      <section
        className="writing-section writing-todos-section"
        aria-labelledby="writing-todos-heading"
      >
        <h3 id="writing-todos-heading" className="writing-section-title">
          <Check size={14} aria-hidden="true" />
          Notes
          <span className="writing-count">{summary.todos.length}</span>
        </h3>
        {summary.todos.length === 0 ? (
          <p className="writing-empty">No TODO or FIXME notes.</p>
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
                  {item.kind === 'FIXME' && <WarningCircle size={13} aria-hidden="true" />}
                  <span className={'writing-tag ' + item.kind.toLowerCase()}>{item.kind}</span>
                  <span className="writing-todo-text">
                    {item.text || `${item.kind} on line ${item.line}`}
                  </span>
                  <small>Ln {item.line}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
