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

it('debounces rapid preference updates and flushes on preferencesSaved()', async () => {
  vi.resetModules();
  let setCalls = 0;
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    textra: {
      getPreferences: async () => ({ ok: true, value: { ...DEFAULT_PREFERENCES } }),
      setPreferences: async () => {
        setCalls++;
        return { ok: true, value: undefined };
      },
    },
  });
  const { hydratePreferences, preferencesSaved } = await import('../../src/renderer/src/state/ui');
  await hydratePreferences();

  const { useUI } = await import('../../src/renderer/src/state/ui');
  // Rapidly call updatePreferences 5 times (like dragging a slider or split handle)
  useUI.getState().updatePreferences({ sidebarWidth: 200 });
  useUI.getState().updatePreferences({ sidebarWidth: 220 });
  useUI.getState().updatePreferences({ sidebarWidth: 240 });
  useUI.getState().updatePreferences({ sidebarWidth: 260 });
  useUI.getState().updatePreferences({ sidebarWidth: 280 });

  expect(setCalls).toBe(0);

  // preferencesSaved flushes the debounced queue immediately
  await preferencesSaved();
  expect(setCalls).toBe(1);
  expect(useUI.getState().preferences.sidebarWidth).toBe(280);
});
