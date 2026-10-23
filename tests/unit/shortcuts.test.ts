import { describe, expect, it } from 'vitest';
import {
  formatShortcutFromEvent,
  matchesShortcut,
  type ShortcutKeyboardEvent,
} from '../../src/shared/shortcuts';

describe('keyboard shortcuts matcher', () => {
  it('matches simple key combinations', () => {
    const event: ShortcutKeyboardEvent = {
      ctrlKey: true,
      key: 's',
      code: 'KeyS',
    };
    expect(matchesShortcut(event, 'Ctrl/Cmd + S')).toBe(true);
    expect(matchesShortcut(event, 'Ctrl + S')).toBe(true);
    expect(matchesShortcut(event, 'Ctrl/Cmd + Shift + S')).toBe(false);
  });

  it('matches shift and alt modifiers', () => {
    const shiftEvent: ShortcutKeyboardEvent = {
      ctrlKey: true,
      shiftKey: true,
      key: 'S',
      code: 'KeyS',
    };
    expect(matchesShortcut(shiftEvent, 'Ctrl/Cmd + Shift + S')).toBe(true);
    expect(matchesShortcut(shiftEvent, 'Ctrl/Cmd + S')).toBe(false);

    const altEvent: ShortcutKeyboardEvent = {
      altKey: true,
      key: 'z',
      code: 'KeyZ',
    };
    expect(matchesShortcut(altEvent, 'Alt + Z')).toBe(true);
    expect(matchesShortcut(altEvent, 'Ctrl + Z')).toBe(false);
  });

  it('matches enter and escape', () => {
    const enterEvent: ShortcutKeyboardEvent = {
      ctrlKey: true,
      key: 'Enter',
      code: 'Enter',
    };
    expect(matchesShortcut(enterEvent, 'Ctrl/Cmd + Enter')).toBe(true);

    const escEvent: ShortcutKeyboardEvent = {
      key: 'Escape',
      code: 'Escape',
    };
    expect(matchesShortcut(escEvent, 'Escape')).toBe(true);
  });

  it('matches symbols like slash', () => {
    const slashEvent: ShortcutKeyboardEvent = {
      ctrlKey: true,
      key: '/',
      code: 'Slash',
    };
    expect(matchesShortcut(slashEvent, 'Ctrl/Cmd + /')).toBe(true);
  });

  it('formats recorded keyboard events and round-trips with matchesShortcut', () => {
    expect(
      formatShortcutFromEvent({
        ctrlKey: true,
        key: 'Control',
        code: 'ControlLeft',
      }),
    ).toBeNull();

    const saveAllEvent: ShortcutKeyboardEvent = {
      ctrlKey: true,
      altKey: true,
      key: 's',
      code: 'KeyS',
    };
    const formatted = formatShortcutFromEvent(saveAllEvent);
    expect(formatted).toBe('Ctrl/Cmd + Alt + S');
    expect(matchesShortcut(saveAllEvent, formatted!)).toBe(true);

    const shiftEvent: ShortcutKeyboardEvent = {
      ctrlKey: true,
      shiftKey: true,
      key: 'F',
      code: 'KeyF',
    };
    expect(formatShortcutFromEvent(shiftEvent)).toBe('Ctrl/Cmd + Shift + F');
  });
});
