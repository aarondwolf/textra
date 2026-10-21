import { useEffect, useRef, useState } from 'react';
import './save-status.css';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function Check({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

/**
 * Dialog footer that makes autosave visible: a live status line ("Saving…", an
 * animated "All changes saved") and a Save settings button that waits for any
 * in-flight writes, confirms with a check, then closes.
 */
export function SaveFooter({
  state,
  error,
  onSave,
  onClose,
}: {
  state: SaveState;
  error?: string | null;
  /** Flushes pending work. Resolve false to keep the dialog open. */
  onSave: () => Promise<boolean>;
  onClose: () => void;
}) {
  // A "saved" left over from before the dialog opened is not news; start calm.
  const [shown, setShown] = useState<SaveState>(state === 'saved' ? 'idle' : state);
  const mounted = useRef(false);
  const [button, setButton] = useState<'idle' | 'saving' | 'done'>('idle');
  // Bumped on every new "saved" so the check animation replays.
  const [pulse, setPulse] = useState(0);
  const closing = useRef<number | null>(null);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setShown(state);
    if (state === 'saved') {
      setPulse((value) => value + 1);
      const timer = window.setTimeout(() => setShown('idle'), 2600);
      return () => window.clearTimeout(timer);
    }
  }, [state]);
  useEffect(
    () => () => {
      if (closing.current) window.clearTimeout(closing.current);
    },
    [],
  );

  async function save() {
    if (button !== 'idle') return;
    setButton('saving');
    const started = Date.now();
    const ok = await onSave().catch(() => false);
    // A short minimum keeps the confirmation readable even when nothing was pending.
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 420 - (Date.now() - started))));
    if (!ok) {
      setButton('idle');
      return;
    }
    setButton('done');
    closing.current = window.setTimeout(onClose, 850);
  }

  const message =
    shown === 'saving'
      ? 'Saving…'
      : shown === 'saved'
        ? 'All changes saved'
        : shown === 'error'
          ? error || 'The last change could not be saved.'
          : 'Changes save automatically';
  return (
    <div className="save-footer">
      <p className="save-status" data-state={shown} role="status" aria-live="polite">
        <span className="save-status-icon" aria-hidden="true">
          {shown === 'saving' && <span className="save-spinner" />}
          {shown === 'saved' && <Check key={pulse} className="save-check" />}
          {shown === 'error' && <span className="save-error-dot">!</span>}
          {shown === 'idle' && <Check className="save-check save-check-static" />}
        </span>
        <span>{message}</span>
      </p>
      <button
        type="button"
        className="save-button"
        data-state={button}
        disabled={button !== 'idle'}
        onClick={() => void save()}
      >
        <span className="save-button-label">
          {button === 'saving' ? (
            <>
              <span className="save-spinner" aria-hidden="true" />
              Saving…
            </>
          ) : button === 'done' ? (
            <>
              <Check className="save-check save-check-button" />
              Saved
            </>
          ) : (
            'Save settings'
          )}
        </span>
      </button>
    </div>
  );
}
