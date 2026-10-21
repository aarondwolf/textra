import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AIChatStore } from '../../src/main/services/ai-chats';
describe('workspace-specific local chat history', () => {
  let directory: string;
  const roots: Record<string, string> = {
    one: 'C:/workspace/one',
    reopened: 'C:/workspace/one',
    two: 'C:/workspace/two',
  };
  const resolve = (id: string) => {
    if (!roots[id]) throw new Error('Invalid project token');
    return roots[id];
  };
  const chat = (id = 'chat-1', updatedAt = 1) => ({
    id,
    title: 'Debugging',
    updatedAt,
    messages: [{ role: 'user' as const, text: 'Help with this error.' }],
  });
  beforeEach(async () => {
    const parent = join(process.cwd(), 'test-results', 'ai-chats');
    await mkdir(parent, { recursive: true });
    directory = await mkdtemp(join(parent, 'case-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  it('restores after restart/reopen and keeps other workspaces isolated', async () => {
    const store = new AIChatStore(directory, resolve);
    await store.save({ projectId: 'one', chat: chat() });
    expect(await new AIChatStore(directory, resolve).list('reopened')).toEqual([chat()]);
    expect(await store.list('two')).toEqual([]);
    await expect(store.list('../invalid')).rejects.toThrow('Invalid project token');
  });
  it('serializes snapshots, preserves newest history, and permits already registered prior-workspace saves', async () => {
    let active = 'one';
    const store = new AIChatStore(directory, (id) => {
      if (id !== active) throw new Error('Expired token');
      return roots[id];
    });
    await store.list('one');
    active = 'two';
    await Promise.all([
      store.save({ projectId: 'one', chat: chat('chat-1', 3) }),
      store.save({ projectId: 'one', chat: chat('chat-1', 2) }),
    ]);
    expect((await store.list('one'))[0].updatedAt).toBe(3);
  });
  it('preserves corrupt/newer history rather than overwriting it', async () => {
    const store = new AIChatStore(directory, resolve);
    await store.save({ projectId: 'one', chat: chat() });
    const file = join(
      directory,
      (await readdir(directory)).find((name) => name.endsWith('.json'))!,
    );
    const content = '{"version":99,"chats":[]}';
    await writeFile(file, content);
    await expect(store.list('one')).rejects.toMatchObject({ code: 'AI_CHAT_STORAGE' });
    await expect(store.save({ projectId: 'one', chat: chat('chat-2') })).rejects.toMatchObject({
      code: 'AI_CHAT_STORAGE',
    });
    expect(await readFile(file, 'utf8')).toBe(content);
  });
  it('allows restored trailing and consecutive user turns but rejects invalid/bloated transcripts', async () => {
    const store = new AIChatStore(directory, resolve);
    const valid = {
      ...chat(),
      messages: [...chat().messages, { role: 'user' as const, text: 'Please implement.' }],
    };
    await store.save({ projectId: 'one', chat: valid });
    expect(await store.list('one')).toEqual([valid]);
    expect(() =>
      store.save({
        projectId: 'one',
        chat: { ...chat(), messages: [{ role: 'system', text: 'unsafe' }] },
      }),
    ).toThrow();
    expect(() =>
      store.save({
        projectId: 'one',
        chat: { ...chat(), messages: [{ role: 'user', text: 'x'.repeat(128001) }] },
      }),
    ).toThrow();
  });
});
