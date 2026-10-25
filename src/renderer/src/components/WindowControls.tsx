import { useEffect, useState } from 'react';
import { CopySimple, Minus, Square, X } from '@phosphor-icons/react';
import type { WindowAction, WindowState } from '../../../shared/api';
import { IconButton } from './Button';
import { useWindowChrome } from '../state/window-chrome';

/** Theme-aware caption actions; main retains ownership of window and close lifecycle. */
export function WindowControls() {
  const [state, setState] = useState<WindowState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const modalCount = useWindowChrome((chrome) => chrome.modalCount);

  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const update = (value: WindowState) => {
      if (!active) return;
      setState(value);
      document.documentElement.dataset.windowControls = value.customControls ? 'custom' : 'native';
    };
    const unsubscribe = window.textra.onWindowState((value) => {
      receivedEvent = true;
      update(value);
    });
    void window.textra
      .getWindowState()
      .then((result) => {
        if (result.ok && !receivedEvent) update(result.value);
      })
      .catch(() => setError('Window controls could not be loaded.'));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function control(action: WindowAction) {
    try {
      const result = await window.textra.controlWindow(action);
      setError(result.ok ? null : result.error);
    } catch {
      setError('The window action could not be completed.');
    }
  }

  if (!state?.customControls) return null;
  return (
    <div
      className="window-caption-controls"
      data-window-controls
      role="group"
      aria-label="Window controls"
      aria-live="polite"
      style={{ filter: `brightness(${(7 / 15) ** modalCount})` }}
    >
      <IconButton
        label="Minimize window"
        className="window-caption-button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void control('minimize')}
      >
        <Minus size={15} aria-hidden="true" />
      </IconButton>
      <IconButton
        label={state.maximized ? 'Restore window' : 'Maximize window'}
        className="window-caption-button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void control('toggle-maximize')}
      >
        {state.maximized ? (
          <CopySimple size={15} aria-hidden="true" />
        ) : (
          <Square size={14} aria-hidden="true" />
        )}
      </IconButton>
      <IconButton
        label="Close window"
        className="window-caption-button window-caption-close"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void control('close')}
      >
        <X size={15} aria-hidden="true" />
      </IconButton>
      {error && (
        <span className="window-caption-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
