import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ConflictDocument, ExternalChangeStatus, PreserveConflictOptions } from './types';
import './conflicts.css';

export interface ConflictDialogProps {
  open: boolean;
  document: ConflictDocument | null;
  external: ExternalChangeStatus;
  /** Save the in-memory buffer as a collision-safe sibling CONFLICTED copy. */
  onPreserve: (options: PreserveConflictOptions) => void | Promise<void>;
  /** Close TeXtra's buffer without writing it. */
  onDiscard: () => void | Promise<void>;
  /** Re-read the external state; comparison remains unavailable until stable. */
  onRefresh: () => void | Promise<void>;
  /** Optional explicit action for making another saved snapshot. */
  onCreateSnapshot?: (options: PreserveConflictOptions) => void | Promise<void>;
}

function statusCopy(external: ExternalChangeStatus): string {
  if (external.detail) return external.detail;
  if (external.state === 'missing')
    return 'The file was removed externally. Preserve a copy of your buffer, or close this tab.';
  if (external.state === 'renamed')
    return 'The file was renamed externally. Preserve a copy of your buffer, or close this tab.';
  if (external.state === 'changing') {
    const remaining = Math.max(0, (external.quietPeriodMs ?? 0) - (external.quietForMs ?? 0));
    return remaining
      ? `Waiting for external writes to settle (${Math.ceil(remaining / 1000)}s).`
      : 'This file is being changed externally.';
  }
  return 'The external file appears stable and can be compared safely.';
}

export function ConflictDialog({
  open,
  document,
  external,
  onPreserve,
  onDiscard,
  onRefresh,
  onCreateSnapshot,
}: ConflictDialogProps) {
  const [compareWhenStable, setCompareWhenStable] = useState(false);
  const [busy, setBusy] = useState<'preserve' | 'discard' | 'refresh' | 'snapshot' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setBusy(null);
      setCompareWhenStable(false);
    }
  }, [open, document?.path]);

  const run = async (operation: NonNullable<typeof busy>, action: () => void | Promise<void>) => {
    setBusy(operation);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The operation could not be completed.');
    } finally {
      setBusy(null);
    }
  };

  const stable = external.state === 'stable';
  const unavailable = external.state === 'missing' || external.state === 'renamed';
  const options = { compareWhenStable };
  return (
    <Dialog.Root open={open} modal>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="conflict-dialog"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title>External change detected</Dialog.Title>
          <Dialog.Description>
            <code>{document?.path ?? 'This file'}</code> changed outside TeXtra. Your open text is
            held safely in memory, and TeXtra will not save it over the external version.
          </Dialog.Description>

          <div className={`conflict-activity ${external.state}`} role="status" aria-live="polite">
            <span className="conflict-orbit" aria-hidden="true" />
            <div>
              <strong>
                {external.state === 'changing'
                  ? 'External editor is active'
                  : 'External state checked'}
              </strong>
              <span>{statusCopy(external)}</span>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy !== null}
              onClick={() => void run('refresh', onRefresh)}
            >
              {busy === 'refresh' ? 'Checking…' : 'Check again'}
            </button>
          </div>

          <section className="conflict-choice" aria-labelledby="preserve-conflict-title">
            <h3 id="preserve-conflict-title">Preserve my TeXtra edits</h3>
            <p>
              Save the current in-editor buffer beside the original as a dated{' '}
              <code>CONFLICTED</code> copy. This never replaces either version.
            </p>
            <label className="conflict-checkbox">
              <input
                type="checkbox"
                checked={compareWhenStable}
                onChange={(event) => setCompareWhenStable(event.target.checked)}
                disabled={busy !== null || unavailable}
              />
              Compare with the external version when it is stable
            </label>
            {!stable && compareWhenStable && !unavailable && (
              <p className="conflict-hint">
                Comparison will wait until external writes have stopped.
              </p>
            )}
            <div className="conflict-choice-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busy !== null || !document}
                onClick={() => void run('preserve', () => onPreserve(options))}
              >
                {busy === 'preserve'
                  ? 'Saving copy…'
                  : unavailable
                    ? 'Save recovery copy'
                    : 'Save conflicted copy'}
              </button>
              {onCreateSnapshot && (
                <button
                  type="button"
                  disabled={busy !== null || !document}
                  onClick={() => void run('snapshot', () => onCreateSnapshot(options))}
                >
                  {busy === 'snapshot' ? 'Saving snapshot…' : 'Create another snapshot'}
                </button>
              )}
            </div>
          </section>

          <section className="conflict-choice" aria-labelledby="discard-conflict-title">
            <h3 id="discard-conflict-title">Discard TeXtra buffer</h3>
            <p>
              Close TeXtra’s buffer without writing it. The external file on disk is left untouched.
            </p>
            <button
              type="button"
              className="danger-button"
              disabled={busy !== null || !document}
              onClick={() => void run('discard', onDiscard)}
            >
              {busy === 'discard' ? 'Closing buffer…' : 'Discard and close tab'}
            </button>
          </section>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
