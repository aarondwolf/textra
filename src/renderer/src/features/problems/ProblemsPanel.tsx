import { useMemo, useState } from 'react';
import { ArrowSquareOut, Copy, Sparkle } from '@phosphor-icons/react';
import './problems.css';

export type ProblemSeverity = 'error' | 'warning' | 'info';

/** A serializable diagnostic from a compiler, linter, or future language service. */
export interface ProblemDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  severity: ProblemSeverity;
  source?: string;
  message: string;
  code?: string;
}

export interface ProblemsPanelProps {
  diagnostics: readonly ProblemDiagnostic[];
  onNavigate?: (diagnostic: ProblemDiagnostic) => void;
  onSearchStackExchange?: (diagnostic: ProblemDiagnostic) => void;
  onCopyPrompt?: (diagnostic: ProblemDiagnostic) => void;
  /** Reserved for the built-in chat integration. */
  onAskChat?: (diagnostic: ProblemDiagnostic) => void;
}

type SeverityFilter = 'all' | ProblemSeverity;

const severityLabel: Record<ProblemSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

function diagnosticLocation(diagnostic: ProblemDiagnostic): string | null {
  if (!diagnostic.file) return null;
  const line = diagnostic.line ? `:${diagnostic.line}` : '';
  const column = diagnostic.column ? `:${diagnostic.column}` : '';
  return `${diagnostic.file}${line}${column}`;
}

function problemSearchLabel(diagnostic: ProblemDiagnostic): string {
  return diagnostic.code ? `${diagnostic.code}: ${diagnostic.message}` : diagnostic.message;
}

function ActionButton({
  title,
  children,
  onClick,
  disabled,
}: {
  title: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="problem-action"
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function ProblemActions({
  diagnostic,
  onSearchStackExchange,
  onCopyPrompt,
  onAskChat,
}: Pick<ProblemsPanelProps, 'onSearchStackExchange' | 'onCopyPrompt' | 'onAskChat'> & {
  diagnostic: ProblemDiagnostic;
}) {
  return (
    <div className="problem-actions" aria-label="Problem actions">
      <ActionButton
        title="Search TeX Stack Exchange"
        onClick={() => onSearchStackExchange?.(diagnostic)}
        disabled={!onSearchStackExchange}
      >
        <ArrowSquareOut size={13} aria-hidden="true" />
        <span>Stack Exchange</span>
      </ActionButton>
      <ActionButton
        title="Copy an AI troubleshooting prompt"
        onClick={() => onCopyPrompt?.(diagnostic)}
        disabled={!onCopyPrompt}
      >
        <Copy size={13} aria-hidden="true" />
        <span>Copy prompt</span>
      </ActionButton>
      <ActionButton
        title={
          onAskChat ? 'Ask in Chat' : 'Ask in Chat will be available when built-in chat is added'
        }
        onClick={() => onAskChat?.(diagnostic)}
        disabled={!onAskChat}
      >
        <Sparkle size={13} aria-hidden="true" />
        <span>Ask in Chat</span>
      </ActionButton>
    </div>
  );
}

/**
 * Unified view for compiler, linter, and language-service diagnostics. It keeps
 * source-specific behavior at the integration boundary through its callbacks.
 */
export function ProblemsPanel({
  diagnostics,
  onNavigate,
  onSearchStackExchange,
  onCopyPrompt,
  onAskChat,
}: ProblemsPanelProps) {
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const visible = useMemo(
    () => diagnostics.filter((diagnostic) => filter === 'all' || diagnostic.severity === filter),
    [diagnostics, filter],
  );
  const groups = useMemo(() => {
    const next = new Map<string, ProblemDiagnostic[]>();
    for (const diagnostic of visible) {
      const key = diagnostic.file ?? 'Workspace';
      next.set(key, [...(next.get(key) ?? []), diagnostic]);
    }
    return [...next.entries()];
  }, [visible]);
  const counts = useMemo(
    () =>
      diagnostics.reduce<Record<ProblemSeverity, number>>(
        (total, diagnostic) => ({
          ...total,
          [diagnostic.severity]: total[diagnostic.severity] + 1,
        }),
        { error: 0, warning: 0, info: 0 },
      ),
    [diagnostics],
  );

  if (!diagnostics.length) {
    return <div className="problems-empty">No problems reported yet.</div>;
  }

  return (
    <section className="problems-panel" aria-label="Problems">
      <div className="problems-toolbar">
        <span className="problems-total">{diagnostics.length} problems</span>
        <label className="problems-filter">
          <span className="sr-only">Filter problems by severity</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as SeverityFilter)}
          >
            <option value="all">All ({diagnostics.length})</option>
            <option value="error">Errors ({counts.error})</option>
            <option value="warning">Warnings ({counts.warning})</option>
            <option value="info">Info ({counts.info})</option>
          </select>
        </label>
      </div>
      {groups.length ? (
        <div className="problems-groups">
          {groups.map(([file, problems]) => (
            <section className="problems-group" key={file} aria-label={`${file} problems`}>
              <h3 className="problems-file" title={file}>
                {file}
                <span>{problems.length}</span>
              </h3>
              <ul className="problems-list">
                {problems.map((diagnostic, index) => {
                  const location = diagnosticLocation(diagnostic);
                  const canNavigate = Boolean(diagnostic.file && onNavigate);
                  return (
                    <li
                      className={`problem problem-${diagnostic.severity}`}
                      key={`${location}:${diagnostic.message}:${index}`}
                    >
                      <button
                        className="problem-main"
                        type="button"
                        disabled={!canNavigate}
                        onClick={() => onNavigate?.(diagnostic)}
                      >
                        <span className="problem-severity">
                          {severityLabel[diagnostic.severity]}
                        </span>
                        <span className="problem-copy">
                          <span className="problem-message">{problemSearchLabel(diagnostic)}</span>
                          {(location || diagnostic.source) && (
                            <span className="problem-meta">
                              {[location, diagnostic.source].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                      </button>
                      <ProblemActions
                        diagnostic={diagnostic}
                        onSearchStackExchange={onSearchStackExchange}
                        onCopyPrompt={onCopyPrompt}
                        onAskChat={onAskChat}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="problems-empty">No {filter} problems.</div>
      )}
    </section>
  );
}
