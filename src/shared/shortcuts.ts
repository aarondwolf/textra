/**
 * Shared keyboard shortcuts definitions and event matching logic for TeXtra.
 */

export interface ShortcutDefinition {
  id: string;
  label: string;
  defaultKeys: string;
  category: 'file' | 'build' | 'view' | 'edit' | 'ai';
  event?: string;
  description?: string;
}

export const DEFAULT_SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'save',
    label: 'Save',
    defaultKeys: 'Ctrl/Cmd + S',
    category: 'file',
    event: 'textra:save-active',
  },
  {
    id: 'saveCopy',
    label: 'Save a copy',
    defaultKeys: 'Ctrl/Cmd + Shift + S',
    category: 'file',
    event: 'textra:save-copy',
  },
  {
    id: 'compile',
    label: 'Compile active document',
    defaultKeys: 'Ctrl/Cmd + Enter',
    category: 'build',
    event: 'textra:compile',
  },
  { id: 'commandPalette', label: 'Command palette', defaultKeys: 'Ctrl/Cmd + K', category: 'view' },
  { id: 'toggleSidebar', label: 'Toggle sidebar', defaultKeys: 'Ctrl/Cmd + B', category: 'view' },
  { id: 'togglePreview', label: 'Preview / Output', defaultKeys: 'Ctrl/Cmd + J', category: 'view' },
  {
    id: 'find',
    label: 'Find / replace',
    defaultKeys: 'Ctrl/Cmd + F',
    category: 'edit',
    event: 'textra:find-pdf',
  },
  {
    id: 'switchModel',
    label: 'Switch chat model',
    defaultKeys: 'Ctrl/Cmd + /',
    category: 'ai',
    event: 'textra:switch-model',
  },
  {
    id: 'inlineEdit',
    label: 'Inline AI edit',
    defaultKeys: 'Ctrl/Cmd + I',
    category: 'ai',
    event: 'textra:inline-edit',
  },
  { id: 'escape', label: 'Close a menu or search', defaultKeys: 'Escape', category: 'view' },
];

export const AVAILABLE_ADD_ACTIONS: readonly ShortcutDefinition[] = [
  {
    id: 'saveAll',
    label: 'Save all open files',
    defaultKeys: 'Ctrl/Cmd + Alt + S',
    category: 'file',
    event: 'textra:save-all',
  },
  {
    id: 'formatDocument',
    label: 'Format document with latexindent',
    defaultKeys: 'Ctrl/Cmd + Shift + F',
    category: 'edit',
    event: 'textra:format-document',
  },
  {
    id: 'cleanArtifacts',
    label: 'Clean generated build files',
    defaultKeys: 'Ctrl/Cmd + Shift + C',
    category: 'build',
    event: 'textra:clean-artifacts',
  },
  {
    id: 'cleanAux',
    label: 'Clear auxiliary build files',
    defaultKeys: 'Ctrl/Cmd + Alt + C',
    category: 'build',
    event: 'textra:clean-aux',
  },
  {
    id: 'openFolder',
    label: 'Open project folder',
    defaultKeys: 'Ctrl/Cmd + O',
    category: 'file',
    event: 'textra:open-folder',
  },
  {
    id: 'newFile',
    label: 'New file',
    defaultKeys: 'Ctrl/Cmd + N',
    category: 'file',
    event: 'textra:new-file',
  },
  {
    id: 'newFolder',
    label: 'New folder',
    defaultKeys: 'Ctrl/Cmd + Shift + N',
    category: 'file',
    event: 'textra:new-folder',
  },
  {
    id: 'replace',
    label: 'Find and replace in editor',
    defaultKeys: 'Ctrl/Cmd + H',
    category: 'edit',
    event: 'textra:replace-source',
  },
  {
    id: 'findPdf',
    label: 'Find in PDF preview',
    defaultKeys: 'Ctrl/Cmd + Shift + P',
    category: 'edit',
    event: 'textra:find-pdf',
  },
  {
    id: 'gotoLine',
    label: 'Go to line',
    defaultKeys: 'Ctrl/Cmd + G',
    category: 'edit',
    event: 'textra:goto-line',
  },
  {
    id: 'toggleWrap',
    label: 'Toggle word wrap',
    defaultKeys: 'Alt + Z',
    category: 'view',
    event: 'textra:toggle-wrap',
  },
  {
    id: 'toggleFormatToolbar',
    label: 'Toggle formatting toolbar',
    defaultKeys: 'Ctrl/Cmd + Shift + T',
    category: 'view',
  },
  {
    id: 'openSettings',
    label: 'Open settings',
    defaultKeys: 'Ctrl/Cmd + ,',
    category: 'view',
    event: 'textra:open-settings',
  },
  {
    id: 'openAiSettings',
    label: 'Open AI settings',
    defaultKeys: 'Ctrl/Cmd + Shift + A',
    category: 'view',
  },
];

export interface ShortcutKeyboardEvent {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  key: string;
  code?: string;
}

/**
 * Checks if a KeyboardEvent matches a shortcut pattern string.
 * Supports patterns like "Ctrl/Cmd + S", "Ctrl + Shift + S", "Alt + Z", "Escape", etc.
 */
export function matchesShortcut(event: ShortcutKeyboardEvent, shortcutPattern: string): boolean {
  if (!shortcutPattern || !shortcutPattern.trim()) return false;

  const alternatives = shortcutPattern.split(/\s+\/\s+/);
  if (alternatives.length > 1 && alternatives.every((alt) => alt.includes('+'))) {
    return alternatives.some((alt) => matchesShortcut(event, alt));
  }

  const tokens = shortcutPattern
    .split('+')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0) return false;

  const hasCtrl = tokens.some((t) =>
    ['ctrl', 'cmd', 'ctrl/cmd', 'cmd/ctrl', 'control', 'meta'].includes(t),
  );
  const hasShift = tokens.some((t) => t === 'shift');
  const hasAlt = tokens.some((t) => t === 'alt' || t === 'option');

  const modifierMatches =
    (hasCtrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey) &&
    (hasShift ? event.shiftKey : !event.shiftKey) &&
    (hasAlt ? event.altKey : !event.altKey);

  if (!modifierMatches) return false;

  const keyToken = tokens
    .slice()
    .reverse()
    .find(
      (t) =>
        ![
          'ctrl',
          'cmd',
          'ctrl/cmd',
          'cmd/ctrl',
          'control',
          'meta',
          'shift',
          'alt',
          'option',
        ].includes(t),
    );

  if (!keyToken) return false;

  const eventKey = event.key.toLowerCase();
  const eventCode = event.code?.toLowerCase();

  if (keyToken === 'enter' || keyToken === 'return') return eventKey === 'enter';
  if (keyToken === 'escape' || keyToken === 'esc') return eventKey === 'escape';
  if (keyToken === 'space') return eventKey === ' ' || eventCode === 'space';
  if (keyToken === 'tab') return eventKey === 'tab';
  if (keyToken === 'backspace') return eventKey === 'backspace';
  if (keyToken === 'delete' || keyToken === 'del') return eventKey === 'delete';

  return (
    eventKey === keyToken ||
    (eventCode !== undefined &&
      (eventCode === `key${keyToken}` || eventCode === `digit${keyToken}`))
  );
}

/**
 * Formats a keyboard event into a normalized TeXtra shortcut pattern string
 * (e.g. "Ctrl/Cmd + Shift + F", "Alt + Z", "Escape").
 * Returns null if the pressed key is only a modifier key.
 */
export function formatShortcutFromEvent(event: ShortcutKeyboardEvent): string | null {
  const rawKey = event.key;
  if (!rawKey) return null;

  const lowerKey = rawKey.toLowerCase();
  if (
    lowerKey === 'control' ||
    lowerKey === 'shift' ||
    lowerKey === 'alt' ||
    lowerKey === 'meta' ||
    lowerKey === 'os' ||
    lowerKey === 'capslock'
  ) {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) {
    parts.push('Ctrl/Cmd');
  }
  if (event.altKey) {
    parts.push('Alt');
  }
  if (event.shiftKey) {
    parts.push('Shift');
  }

  let keyName: string;
  const code = event.code ?? '';
  if (/^Key([A-Z])$/.test(code)) {
    keyName = code.slice(3).toUpperCase();
  } else if (/^Digit([0-9])$/.test(code)) {
    keyName = code.slice(5);
  } else if (lowerKey === ' ' || code === 'Space') {
    keyName = 'Space';
  } else if (lowerKey === 'enter' || lowerKey === 'return') {
    keyName = 'Enter';
  } else if (lowerKey === 'escape' || lowerKey === 'esc') {
    keyName = 'Escape';
  } else if (lowerKey === 'backspace') {
    keyName = 'Backspace';
  } else if (lowerKey === 'delete' || lowerKey === 'del') {
    keyName = 'Delete';
  } else if (lowerKey === 'tab') {
    keyName = 'Tab';
  } else if (lowerKey === 'arrowup') {
    keyName = 'ArrowUp';
  } else if (lowerKey === 'arrowdown') {
    keyName = 'ArrowDown';
  } else if (lowerKey === 'arrowleft') {
    keyName = 'ArrowLeft';
  } else if (lowerKey === 'arrowright') {
    keyName = 'ArrowRight';
  } else if (code === 'Slash') {
    keyName = '/';
  } else if (code === 'Comma') {
    keyName = ',';
  } else if (code === 'Period') {
    keyName = '.';
  } else if (code === 'Semicolon') {
    keyName = ';';
  } else if (code === 'Quote') {
    keyName = "'";
  } else if (code === 'BracketLeft') {
    keyName = '[';
  } else if (code === 'BracketRight') {
    keyName = ']';
  } else if (code === 'Backslash') {
    keyName = '\\';
  } else if (code === 'Minus') {
    keyName = '-';
  } else if (code === 'Equal') {
    keyName = '=';
  } else if (code === 'Backquote') {
    keyName = '`';
  } else if (rawKey.length === 1) {
    keyName = rawKey.toUpperCase();
  } else {
    keyName = rawKey;
  }

  parts.push(keyName);
  return parts.join(' + ');
}
