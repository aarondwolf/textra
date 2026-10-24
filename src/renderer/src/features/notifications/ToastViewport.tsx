import { useEffect, useState } from 'react';
import * as Toast from '@radix-ui/react-toast';
import { X } from '../../icons';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

/** Show a short, non-blocking application notification from any renderer feature. */
export function notify(message: string, tone: ToastTone = 'info'): void {
  window.dispatchEvent(new CustomEvent('textra:notify', { detail: { message, tone } }));
}

function validToast(value: unknown): value is Omit<ToastItem, 'id'> {
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
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    let nextId = 0;
    const show = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!validToast(detail)) return;
      const toast: ToastItem = {
        id: nextId++,
        message: detail.message,
        tone: detail.tone ?? 'info',
      };
      setToasts((current) => [...current.slice(-4), toast]);
    };
    window.addEventListener('textra:notify', show);
    return () => window.removeEventListener('textra:notify', show);
  }, []);

  return (
    <Toast.Provider swipeDirection="right" duration={3800}>
      {toasts.map((toast) => (
        <Toast.Root
          key={toast.id}
          className="toast-root"
          onOpenChange={(open) => {
            if (!open) {
              setToasts((current) => current.filter(({ id }) => id !== toast.id));
            }
          }}
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
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            maxWidth: 360,
          }}
        >
          <Toast.Description>{toast.message}</Toast.Description>
          <Toast.Close
            aria-label="Close notification"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 2,
              borderRadius: 3,
            }}
          >
            <X size={12} aria-hidden="true" />
          </Toast.Close>
        </Toast.Root>
      ))}
      <Toast.Viewport
        style={{
          position: 'fixed',
          bottom: 18,
          right: 18,
          display: 'grid',
          gap: 8,
          maxWidth: 360,
          margin: 0,
          padding: 0,
          listStyle: 'none',
          zIndex: 100,
          outline: 'none',
        }}
      />
    </Toast.Provider>
  );
}
