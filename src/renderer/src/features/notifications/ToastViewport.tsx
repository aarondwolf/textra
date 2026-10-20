import { useEffect, useState } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

/** Show a short, non-blocking application notification from any renderer feature. */
export function notify(message: string, tone: ToastTone = 'info'): void {
  window.dispatchEvent(new CustomEvent('textra:notify', { detail: { message, tone } }));
}

function validToast(value: unknown): value is Omit<Toast, 'id'> {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.message === 'string' &&
    candidate.message.length > 0 &&
    candidate.message.length <= 240 &&
    (candidate.tone === undefined ||
      candidate.tone === 'success' ||
      candidate.tone === 'error' ||
      candidate.tone === 'info')
  );
}

export function ToastViewport() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    let nextId = 0;
    const show = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!validToast(detail)) return;
      const toast = { id: nextId++, message: detail.message, tone: detail.tone ?? 'info' };
      setToasts((current) => [...current.slice(-3), toast]);
      window.setTimeout(
        () => setToasts((current) => current.filter(({ id }) => id !== toast.id)),
        3200,
      );
    };
    window.addEventListener('textra:notify', show);
    return () => window.removeEventListener('textra:notify', show);
  }, []);
  if (!toasts.length) return null;
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      style={{
        bottom: 18,
        display: 'grid',
        gap: 8,
        maxWidth: 360,
        pointerEvents: 'none',
        position: 'fixed',
        right: 18,
        zIndex: 100,
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          style={{
            background: 'var(--raised)',
            border: `1px solid ${
              toast.tone === 'error'
                ? 'var(--alert-error)'
                : toast.tone === 'success'
                  ? 'var(--accent)'
                  : 'var(--border)'
            }`,
            borderRadius: 'var(--radius-surface)',
            boxShadow: '0 10px 26px #0004',
            color: 'var(--text)',
            fontSize: 12,
            padding: '10px 12px',
          }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
