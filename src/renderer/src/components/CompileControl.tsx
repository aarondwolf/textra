import type { CSSProperties } from 'react';
import { Check, ChevronDown, Play, Square, Warning } from '../icons';
import { Button, IconButton } from './Button';

export interface CompileControlProps {
  running: boolean;
  feedback: 'idle' | 'success' | 'failed';
  canCompile: boolean;
  busy: boolean;
  missingTool: boolean;
  engine: string;
  activePath: string | null;
  stepsDone?: number;
  stepCount?: number;
  onCompile: () => void;
  onCancel: () => void;
  recipeToggle?: { open: boolean; onToggle: () => void; controls?: string };
}

/** Shared Compile/Cancel feedback; the caller owns the recipe popup and its focus handling. */
export function CompileControl({
  running,
  feedback,
  canCompile,
  busy,
  missingTool,
  engine,
  activePath,
  stepsDone,
  stepCount,
  onCompile,
  onCancel,
  recipeToggle,
}: CompileControlProps) {
  const title = running
    ? 'Cancel build'
    : feedback === 'success'
      ? 'Build succeeded!'
      : feedback === 'failed'
        ? 'Build failed.'
        : !canCompile
          ? 'Open a .tex document to compile it.'
          : busy
            ? 'Wait for the current file operation to finish.'
            : missingTool
              ? engine + ' not found. Check Settings, LaTeX tools.'
              : 'Compile ' +
                (activePath ?? 'active document') +
                ' with ' +
                engine +
                ' (Ctrl/Cmd+Enter)';
  return (
    <>
      <Button
        variant="toolbar"
        className={`compile-button compile-feedback-${feedback}`}
        data-feedback={feedback}
        aria-label={running ? 'Cancel build' : 'Compile active document'}
        title={title}
        style={
          running && stepCount
            ? ({
                '--progress': `${Math.min(95, (((stepsDone ?? 0) + 0.5) / stepCount) * 100)}%`,
              } as CSSProperties)
            : undefined
        }
        data-progress={running && stepCount ? 'true' : undefined}
        disabled={!running && (!canCompile || busy)}
        onClick={running ? onCancel : onCompile}
      >
        {running ? (
          <Square size={13} />
        ) : feedback === 'success' ? (
          <Check size={13} />
        ) : feedback === 'failed' ? (
          <Warning size={13} />
        ) : (
          <Play size={13} />
        )}
        {running
          ? 'Cancel'
          : feedback === 'success'
            ? 'Success!'
            : feedback === 'failed'
              ? 'Failed'
              : 'Compile'}
      </Button>
      {recipeToggle && (
        <Button
          variant="toolbar"
          className={`compile-button recipe-toggle compile-feedback-${feedback}`}
          data-feedback={feedback}
          aria-label="Choose compile recipe"
          aria-expanded={recipeToggle.open}
          aria-controls={recipeToggle.controls ?? 'compile-recipes'}
          disabled={!canCompile || busy || running}
          title={'Recipe: ' + engine}
          onClick={recipeToggle.onToggle}
        >
          <ChevronDown size={14} />
        </Button>
      )}
    </>
  );
}

export function ProblemsButton({
  severity,
  issueCount,
  errorCount,
  warningCount,
  onClick,
  className,
}: {
  severity: string;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <IconButton
      label={'Show problems' + (issueCount ? ` (${issueCount})` : '')}
      title={
        severity === 'error'
          ? `${errorCount} error${errorCount === 1 ? '' : 's'}`
          : severity === 'warning'
            ? `${warningCount} warning${warningCount === 1 ? '' : 's'}`
            : severity === 'ok'
              ? 'No problems'
              : 'Show problems'
      }
      className={['collapsed-alert', className].filter(Boolean).join(' ')}
      data-severity={severity}
      onClick={onClick}
    >
      <span className="alert-glyph">
        <Warning
          size={15}
          weight={severity === 'error' || severity === 'warning' ? 'fill' : 'light'}
        />
        {severity === 'ok' && <Check size={8} weight="bold" className="alert-check" />}
      </span>
    </IconButton>
  );
}
