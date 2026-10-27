import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '../../src/shared/api';
import { THEME_DEFAULTS, themeSelection } from '../../src/renderer/src/state/themes';

describe('shared theme selection', () => {
  it('replaces every stale color override when changing built-in themes', () => {
    const previous = {
      ...DEFAULT_PREFERENCES,
      ...themeSelection('midnight'),
    };
    const next = { ...previous, ...themeSelection('light') };
    expect(next.theme).toBe('light');
    expect(next.themeCustomizations).toEqual(THEME_DEFAULTS.light);
    expect(themeSelection('dark').themeCustomizations).toEqual(THEME_DEFAULTS.dark);
  });

  it('fills custom theme colors from its base without overwriting its own colors', () => {
    const selected = themeSelection('my-light', [
      { id: 'my-light', name: 'My light theme', baseTheme: 'light', accent: '#123456' },
    ]);
    expect(selected).toEqual({
      theme: 'my-light',
      themeCustomizations: { ...THEME_DEFAULTS.light, accent: '#123456' },
    });
    expect(THEME_DEFAULTS.light.accent).not.toBe('#123456');
  });
});
