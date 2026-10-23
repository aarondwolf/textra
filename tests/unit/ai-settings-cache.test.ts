import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateCreator } from 'zustand/vanilla';
import type { AISettings, Result } from '../../src/shared/api';

// Use Zustand's real vanilla store with a snapshot reader in place of its React binding.
vi.mock('zustand', async () => {
  const { createStore } = await import('zustand/vanilla');
  return {
    create: (initializer: StateCreator<unknown>) => {
      const store = createStore(initializer);
      return Object.assign(() => store.getState(), store);
    },
  };
});
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const settings = (configured = false): AISettings => ({
  configured,
  autoSendProblems: false,
  roleDefaults: { assistant: null, inlineCompletion: null, completion: null },
  completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
  providers: [],
});

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('offline AI settings cache', () => {
  it('deduplicates concurrent reads and reuses the cached result', async () => {
    const read = deferred<Result<AISettings>>();
    const getAISettings = vi.fn(() => read.promise);
    vi.stubGlobal('window', { textra: { getAISettings }, dispatchEvent: vi.fn() });
    const cache = await import('../../src/renderer/src/features/chat/useAISettings');
    const first = cache.loadAISettings();
    const second = cache.loadAISettings();
    expect(first).toBe(second);
    expect(getAISettings).toHaveBeenCalledTimes(1);
    read.resolve({ ok: true, value: settings() });
    await first;
    await cache.loadAISettings();
    expect(getAISettings).toHaveBeenCalledTimes(1);
    expect(cache.useAISettings(false).settings).toEqual(settings());
  });

  it('preserves newly published settings when an older offline read finishes', async () => {
    const read = deferred<Result<AISettings>>();
    vi.stubGlobal('window', {
      textra: { getAISettings: () => read.promise },
      dispatchEvent: vi.fn(),
    });
    const cache = await import('../../src/renderer/src/features/chat/useAISettings');
    const loading = cache.loadAISettings();
    const saved = settings(true);
    cache.publishAISettings(saved);
    read.resolve({ ok: true, value: settings(false) });
    await loading;
    expect(cache.useAISettings(false).settings).toBe(saved);
  });

  it('allows retry after a failed read and keeps cached settings during an explicit refresh', async () => {
    const getAISettings = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'Offline settings unavailable' })
      .mockResolvedValueOnce({ ok: true, value: settings() });
    vi.stubGlobal('window', { textra: { getAISettings }, dispatchEvent: vi.fn() });
    const cache = await import('../../src/renderer/src/features/chat/useAISettings');
    await cache.loadAISettings();
    expect(cache.useAISettings(false).error).toContain('unavailable');
    await cache.loadAISettings();
    expect(cache.useAISettings(false).error).toBe('');
    const refreshed = deferred<Result<AISettings>>();
    getAISettings.mockReturnValueOnce(refreshed.promise);
    const loading = cache.loadAISettings(true);
    expect(cache.useAISettings(false).settings).toEqual(settings());
    refreshed.resolve({ ok: true, value: settings(true) });
    await loading;
    expect(cache.useAISettings(false).settings?.configured).toBe(true);
  });
});
