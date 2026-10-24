/**
 * Strongly typed in-renderer command and notification event bus.
 */

export interface TextraEvents {
  'textra:compile': undefined;
  'textra:save-active': undefined;
  'textra:save-copy': undefined;
  'textra:save-all': undefined;
  'textra:open-folder': undefined;
  'textra:new-file': undefined;
  'textra:new-folder': undefined;
  'textra:find-pdf': undefined;
  'textra:replace-source': undefined;
  'textra:goto-line': undefined;
  'textra:format-document': undefined;
  'textra:clean-artifacts': undefined;
  'textra:clean-aux': undefined;
  'textra:toggle-wrap': undefined;
  'textra:switch-model': undefined;
  'textra:inline-edit': undefined;
  'textra:view-history': undefined;
  'textra:create-snapshot': undefined;
  'textra:history:updated': undefined;
  'textra:open-settings': { section?: string } | undefined;
  'textra:notify': {
    message: string;
    tone?: 'info' | 'error' | 'success';
    type?: 'info' | 'error' | 'success';
  };
  'textra:custom-shortcut': { action: string };
  'textra:apply-agent-edit': { proposal: unknown };
  'textra:apply-document-content': { path: string; content: string };
}

export type TextraEventName = keyof TextraEvents;

const fallbackTarget = new EventTarget();

export function getEventTarget(): EventTarget {
  return typeof window !== 'undefined' ? window : fallbackTarget;
}

/**
 * Dispatches a strongly typed TeXtra command or notification event.
 */
export function emitTextraEvent<K extends TextraEventName>(
  name: K,
  ...args: undefined extends TextraEvents[K]
    ? [detail?: TextraEvents[K]]
    : [detail: TextraEvents[K]]
): boolean {
  const detail = args[0];
  const event = detail !== undefined ? new CustomEvent(name, { detail }) : new Event(name);
  return getEventTarget().dispatchEvent(event);
}

/**
 * Subscribes to a strongly typed TeXtra event, returning an unsubscribe callback.
 */
export function onTextraEvent<K extends TextraEventName>(
  name: K,
  handler: (detail: TextraEvents[K]) => void,
): () => void {
  const target = getEventTarget();
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<TextraEvents[K]>).detail;
    handler(detail);
  };
  target.addEventListener(name, listener);
  return () => target.removeEventListener(name, listener);
}
