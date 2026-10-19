import { describe, expect, it } from 'vitest';
import { validatePreferences } from '../../src/main/services/preferences';
import { DEFAULT_PREFERENCES } from '../../src/shared/api';

describe('preference boundary validation', () => {
  it('migrates existing settings and validates the default recipe', () => {
    const legacy: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
    delete legacy.defaultRecipe;
    delete legacy.previewVisible;
    expect(validatePreferences(legacy)).toEqual(DEFAULT_PREFERENCES);
    expect(validatePreferences({ ...legacy, defaultRecipe: 'xelatex' }).defaultRecipe).toBe(
      'xelatex',
    );
    expect(() => validatePreferences({ ...legacy, defaultRecipe: 'shell' })).toThrow();
  });
  it('accepts both supported themes and boundary split widths', () => {
    for (const theme of ['light', 'dark']) {
      for (const editorWidth of [25, 55.5, 75]) {
        const value = { ...DEFAULT_PREFERENCES, theme, editorWidth };
        expect(validatePreferences(value)).toEqual(value);
      }
    }
  });

  it.each([
    null,
    [],
    'dark',
    {},
    { ...DEFAULT_PREFERENCES, version: 2 },
    { ...DEFAULT_PREFERENCES, theme: 'system' },
    { ...DEFAULT_PREFERENCES, sidebarVisible: 'true' },
    { ...DEFAULT_PREFERENCES, outputVisible: 1 },
    { ...DEFAULT_PREFERENCES, previewVisible: 'yes' },
    { ...DEFAULT_PREFERENCES, editorWidth: '55' },
    { ...DEFAULT_PREFERENCES, editorWidth: NaN },
    { ...DEFAULT_PREFERENCES, editorWidth: Infinity },
    { ...DEFAULT_PREFERENCES, editorWidth: 24.99 },
    { ...DEFAULT_PREFERENCES, editorWidth: 75.01 },
    { ...DEFAULT_PREFERENCES, apiKey: 'must-not-be-stored' },
  ])('rejects unsupported or malformed values: %j', (value) => {
    expect(() => validatePreferences(value)).toThrow();
  });

  it('returns an independent object so callers cannot mutate validated state', () => {
    const input = { ...DEFAULT_PREFERENCES };
    const validated = validatePreferences(input);
    input.theme = 'light';
    expect(validated.theme).toBe('dark');
  });
});
