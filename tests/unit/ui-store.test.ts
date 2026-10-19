import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '../../src/shared/api';

afterEach(() => vi.unstubAllGlobals());

it('hydrates older loaded preferences with a usable default compile recipe', async () => {
  vi.resetModules();
  const legacy: Record<string, unknown> = { ...DEFAULT_PREFERENCES, outputVisible: false };
  delete legacy.defaultRecipe;
  vi.stubGlobal('window', {
    textra: { getPreferences: async () => ({ ok: true, value: legacy }) },
  });
  const { hydratePreferences, useUI } = await import('../../src/renderer/src/state/ui');
  await hydratePreferences();
  expect(useUI.getState().preferences.defaultRecipe).toBe('pdflatex');
  expect(useUI.getState().preferences.outputVisible).toBe(false);
});
