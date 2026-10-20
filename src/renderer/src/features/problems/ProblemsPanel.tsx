import { useEffect, useMemo, useState } from 'react';
import { ArrowSquareOut, Check, Copy, Sparkle } from '@phosphor-icons/react';
import { commonProblemHelp } from '../../../../shared/common-problems';
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
  /** Full diagnostic detail, when a tool provides more than its summary message. */
  detail?: string;
  /** A short, relevant compiler or linter log excerpt, when available. */
  logExcerpt?: string;
}

export interface ProblemsPanelProps {
  diagnostics: readonly ProblemDiagnostic[];
  onNavigate?: (diagnostic: ProblemDiagnostic) => void;
  onSearchStackExchange?: (diagnostic: ProblemDiagnostic) => void;
  onCopyPrompt?: (diagnostic: ProblemDiagnostic) => Promise<void> | void;
  /** Reserved for the built-in chat integration. */
  onAskChat?: (diagnostic: ProblemDiagnostic) => void;
  /** Defaults on; may be disabled from Preferences for a terse diagnostic list. */
  showCommonHelp?: boolean;
  onOpenCommonHelp?: (url: string) => void;
}

type SourceFilter = 'build' | 'chktex' | 'reference' | 'texlab';

const sourceFilters: readonly SourceFilter[] = ['build', 'chktex', 'reference', 'texlab'];
const sourceLabels: Record<SourceFilter, string> = {
  build: 'Build',
  chktex: 'ChkTeX',
  reference: 'References',
  texlab: 'TexLab',
};

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

function problemSource(diagnostic: ProblemDiagnostic): SourceFilter {
  return diagnostic.source === 'chktex' ||
    diagnostic.source === 'reference' ||
    diagnostic.source === 'texlab'
    ? diagnostic.source
    : 'build';
}

function diagnosticId(diagnostic: ProblemDiagnostic): string {
  return [
    diagnostic.file ?? '',
    diagnostic.line ?? '',
    diagnostic.column ?? '',
    diagnostic.severity,
    problemSource(diagnostic),
    diagnostic.code ?? '',
    diagnostic.message,
  ].join('\u001f');
}

function problemSummary(diagnostic: ProblemDiagnostic): string {
  const firstLine = diagnostic.message.split(/\r?\n/, 1)[0] ?? diagnostic.message;
  return firstLine.length > 220 ? `${firstLine.slice(0, 217)}…` : firstLine;
}

function diagnosticDetails(diagnostic: ProblemDiagnostic): string | null {
  const detail = diagnostic.detail?.trim();
  if (detail && detail !== diagnostic.message.trim()) return detail;
  return diagnostic.message.includes('\n') ? diagnostic.message : null;
}

function ActionButton({
  title,
  children,
  onClick,
  disabled,
}: {
  title: string;
  children: React.ReactNode;
  onClick: () => Promise<void> | void;
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
        void onClick();
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
  const [copied, setCopied] = useState(false);

  const handleCopyPrompt = async () => {
    if (!onCopyPrompt) return;

    try {
      await onCopyPrompt(diagnostic);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // The workspace reports clipboard failures in its error banner.
    }
  };

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
        title={copied ? 'Copied troubleshooting prompt' : 'Copy an AI troubleshooting prompt'}
        onClick={handleCopyPrompt}
        disabled={!onCopyPrompt}
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        <span>{copied ? 'Copied' : 'Copy prompt'}</span>
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

function ProblemDetail({
  diagnostic,
  showCommonHelp,
  onOpenCommonHelp,
}: {
  diagnostic: ProblemDiagnostic;
  showCommonHelp: boolean;
  onOpenCommonHelp?: (url: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detail = diagnosticDetails(diagnostic);
  const logExcerpt = diagnostic.logExcerpt?.trim();
  const help = showCommonHelp ? commonProblemHelp(diagnostic.message, diagnostic.detail) : null;
  if (!detail && !logExcerpt && !help) return null;
  const hasDetails = Boolean(detail || logExcerpt);

  return (
    <div className="problem-detail">
      {help && (
        <aside className="common-problem-help">
          <strong>{help.title}</strong>
          <p>{help.explanation}</p>
          <button
            type="button"
            className="common-problem-help-link"
            onClick={() => onOpenCommonHelp?.(help.url)}
          >
            Learn more at TeX FAQ
          </button>
        </aside>
      )}
      {hasDetails && (
        <button
          className="problem-detail-toggle"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Hide details' : 'Show details'}
        </button>
      )}
      {hasDetails && expanded && (
        <div className="problem-detail-content">
          {detail && <pre>{detail}</pre>}
          {logExcerpt && (
            <details className="problem-log-excerpt">
              <summary>Relevant log excerpt</summary>
              <pre>{logExcerpt}</pre>
            </details>
          )}
        </div>
      )}
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
  showCommonHelp = true,
  onOpenCommonHelp,
}: ProblemsPanelProps) {
  const [severityFilter, setSeverityFilter] = useState<ReadonlySet<ProblemSeverity>>(
    () => new Set(['error', 'warning', 'info']),
  );
  const [sourceFilter, setSourceFilter] = useState<ReadonlySet<SourceFilter>>(
    () => new Set(sourceFilters),
  );
  const [activeProblemId, setActiveProblemId] = useState<string | null>(null);
  const visible = useMemo(
    () =>
      diagnostics.filter(
        (diagnostic) =>
          severityFilter.has(diagnostic.severity) && sourceFilter.has(problemSource(diagnostic)),
      ),
    [diagnostics, severityFilter, sourceFilter],
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
  const sourceCounts = useMemo(
    () =>
      diagnostics.reduce<Record<SourceFilter, number>>(
        (total, diagnostic) => {
          total[problemSource(diagnostic)] += 1;
          return total;
        },
        { build: 0, chktex: 0, reference: 0, texlab: 0 },
      ),
    [diagnostics],
  );
  const activeIndex = useMemo(() => {
    const index = activeProblemId
      ? visible.findIndex((diagnostic) => diagnosticId(diagnostic) === activeProblemId)
      : -1;
    return index >= 0 ? index : 0;
  }, [activeProblemId, visible]);

  useEffect(() => {
    if (
      activeProblemId &&
      !visible.some((diagnostic) => diagnosticId(diagnostic) === activeProblemId)
    )
      setActiveProblemId(null);
  }, [activeProblemId, visible]);

  const selectAndNavigate = (index: number) => {
    const diagnostic = visible[index];
    if (!diagnostic) return;
    setActiveProblemId(diagnosticId(diagnostic));
    onNavigate?.(diagnostic);
  };

  const toggleSource = (source: SourceFilter) => {
    setSourceFilter((current) => {
      const next = new Set(current);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const toggleSeverity = (severity: ProblemSeverity) => {
    setSeverityFilter((current) => {
      const next = new Set(current);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  };

  if (!diagnostics.length) {
    return <div className="problems-empty">No problems reported yet.</div>;
  }

  return (
    <section className="problems-panel" aria-label="Problems">
      <div className="problems-toolbar">
        <span className="problems-total">{diagnostics.length} problems</span>
        <div className="problems-navigation" aria-label="Problem navigation">
          <button
            type="button"
            title="Previous problem"
            aria-label="Previous problem"
            disabled={!onNavigate || visible.length < 2}
            onClick={() => selectAndNavigate((activeIndex - 1 + visible.length) % visible.length)}
          >
            Previous
          </button>
          <span aria-live="polite">
            {visible.length ? `${activeIndex + 1} of ${visible.length}` : '0 of 0'}
          </span>
          <button
            type="button"
            title="Next problem"
            aria-label="Next problem"
            disabled={!onNavigate || visible.length < 2}
            onClick={() => selectAndNavigate((activeIndex + 1) % visible.length)}
          >
            Next
          </button>
        </div>
      </div>
      <div className="problems-filters" aria-label="Problem category filters">
        <div className="problems-severity-filters" aria-label="Filter problems by severity">
          {(Object.keys(severityLabel) as ProblemSeverity[]).map((severity) => (
            <button
              className={`problems-severity-filter problems-severity-filter-${severity}`}
              type="button"
              key={severity}
              aria-pressed={severityFilter.has(severity)}
              onClick={() => toggleSeverity(severity)}
            >
              {severityLabel[severity]} ({counts[severity]})
            </button>
          ))}
        </div>
        <div className="problems-source-filters" aria-label="Filter problems by source">
          {sourceFilters.map((source) => (
            <button
              className="problems-source-filter"
              type="button"
              key={source}
              aria-pressed={sourceFilter.has(source)}
              onClick={() => toggleSource(source)}
            >
              {sourceLabels[source]} ({sourceCounts[source]})
            </button>
          ))}
        </div>
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
                  const id = diagnosticId(diagnostic);
                  return (
                    <li
                      className={`problem problem-${diagnostic.severity}${
                        activeProblemId === id ? ' problem-active' : ''
                      }`}
                      key={`${location}:${diagnostic.message}:${index}`}
                    >
                      <button
                        className="problem-main"
                        type="button"
                        disabled={!canNavigate}
                        onClick={() => selectAndNavigate(visible.indexOf(diagnostic))}
                        onFocus={() => setActiveProblemId(id)}
                      >
                        <span className="problem-severity">
                          {severityLabel[diagnostic.severity]}
                        </span>
                        <span className="problem-copy">
                          <span className="problem-message" title={problemSearchLabel(diagnostic)}>
                            {diagnostic.code ? `${diagnostic.code}: ` : ''}
                            {problemSummary(diagnostic)}
                          </span>
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
                      <ProblemDetail
                        diagnostic={diagnostic}
                        showCommonHelp={showCommonHelp}
                        onOpenCommonHelp={onOpenCommonHelp}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="problems-empty">No problems match these filters.</div>
      )}
    </section>
  );
}
