import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PreferencesStore } from '../../src/main/services/preferences';
import { DEFAULT_PREFERENCES } from '../../src/shared/api';

describe('preference files in isolated temporary storage', () => {
  let directory: string;
  let store: PreferencesStore;

  beforeEach(async () => {
    // Keep atomic-write fixtures outside synchronized Dropbox/OneDrive folders.
    directory = await mkdtemp(join(tmpdir(), 'textra-preferences-'));
    store = new PreferencesStore(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('uses defaults without creating a file before the first preference change', async () => {
    expect(await store.get()).toEqual(DEFAULT_PREFERENCES);
    expect(await readdir(directory)).toEqual([]);
  });

  it('persists preferences across instances and does not expose mutable cached state', async () => {
    const value = { ...DEFAULT_PREFERENCES, theme: 'light' as const, sidebarVisible: false };
    await store.set(value);
    expect(await new PreferencesStore(directory).get()).toEqual(value);
    const returned = await store.get();
    returned.editorWidth = 30;
    expect((await store.get()).editorWidth).toBe(value.editorWidth);
    expect(JSON.parse(await readFile(join(directory, 'preferences.json'), 'utf8'))).toEqual(value);
    expect(await readdir(directory)).toEqual(['preferences.json']);
  });

  it('rejects invalid changes without damaging the existing file', async () => {
    await store.set(DEFAULT_PREFERENCES);
    const previous = await readFile(join(directory, 'preferences.json'), 'utf8');
    await expect(store.set({ ...DEFAULT_PREFERENCES, editorWidth: -1 })).rejects.toThrow();
    expect(await readFile(join(directory, 'preferences.json'), 'utf8')).toBe(previous);
  });

  it('serializes concurrent writes and leaves the latest complete value on disk', async () => {
    const values = [30, 40, 70].map((editorWidth) => ({ ...DEFAULT_PREFERENCES, editorWidth }));
    await Promise.all(values.map((value) => store.set(value)));
    expect(await new PreferencesStore(directory).get()).toEqual(values[2]);
    expect(await readdir(directory)).toEqual(['preferences.json']);
  });

  it.each(['{broken JSON', JSON.stringify({ ...DEFAULT_PREFERENCES, version: 999 })])(
    'preserves corrupt or unsupported settings rather than silently replacing them',
    async (content) => {
      await writeFile(join(directory, 'preferences.json'), content, 'utf8');
      await expect(store.get()).rejects.toThrow();
      expect(await readFile(join(directory, 'preferences.json'), 'utf8')).toBe(content);
    },
  );
});
