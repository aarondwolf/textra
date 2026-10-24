import type { CSSProperties, ReactNode } from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, Play, Square, Warning } from '../icons';
import { Button, IconButton } from './Button';

export interface CompileControlProps {
  variant?: 'toolbar' | 'collapsed';
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
  recipeTrigger?: ReactNode;
}

/** Shared Compile/Cancel feedback; the caller owns the recipe popup and its focus handling. */
export function CompileControl({
  variant = 'toolbar',
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
  recipeTrigger,
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

  if (variant === 'collapsed') {
    return (
      <button
        type="button"
        className={`collapsed-compile collapsed-feedback-${feedback}`}
        data-feedback={feedback}
        data-running={running ? 'true' : undefined}
        aria-label={running ? 'Cancel build' : 'Compile active document'}
        title={title}
        disabled={!running && (!canCompile || busy)}
        onClick={running ? onCancel : onCompile}
      >
        {running ? (
          <Square size={11} />
        ) : feedback === 'success' ? (
          <Check size={11} />
        ) : feedback === 'failed' ? (
          <Warning size={11} />
        ) : (
          <Play size={11} weight="fill" />
        )}
      </button>
    );
  }

  return (
    <div className="compile-control" role="group" aria-label="Compile controls">
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
      {recipeTrigger}
    </div>
  );
}

export function CompileRecipeTrigger({
  feedback,
  engine,
  disabled,
}: {
  feedback: CompileControlProps['feedback'];
  engine: string;
  disabled: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Trigger asChild>
      <Button
        variant="toolbar"
        className={`compile-button recipe-toggle compile-feedback-${feedback}`}
        data-feedback={feedback}
        aria-label="Choose compile recipe"
        disabled={disabled}
        title={'Recipe: ' + engine}
      >
        <ChevronDown size={14} />
      </Button>
    </DropdownMenuPrimitive.Trigger>
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
