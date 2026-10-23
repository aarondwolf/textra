/** Yield until after a paint; optional work must never delay the first editor frame. */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => window.setTimeout(resolve, 0)));
}

/** A cancellable idle task, with a timeout so quiet background features eventually load. */
export function scheduleBackground(task: () => void, timeout = 1000): () => void {
  let idle: number | undefined;
  let cancelled = false;
  const timer = window.setTimeout(() => {
    if (cancelled) return;
    if ('requestIdleCallback' in window) {
      idle = window.requestIdleCallback(
        () => {
          if (!cancelled) task();
        },
        { timeout },
      );
    } else task();
  }, 0);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}

export function markStartup(
  name: 'shell-visible' | 'editor-ready' | 'pdf-ready' | 'compile-dispatch',
): void {
  const key = `textra:${name}`;
  if (!performance.getEntriesByName(key).length) performance.mark(key);
}
