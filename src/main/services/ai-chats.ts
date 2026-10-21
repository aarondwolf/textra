import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { AIStoredChat } from '../../shared/ai';
import type { AIMessage } from '../../shared/api';
import { AIError } from './gemini';

const MAX_BYTES = 16 * 1024 * 1024;
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function invalid(): never {
  throw new AIError(
    'AI_CHAT_STORAGE',
    'Chat history could not be saved or restored. Existing history was preserved.',
  );
}
function validateChat(value: unknown): AIStoredChat {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    !/^[A-Za-z0-9-]{1,64}$/.test(value.id) ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 120 ||
    typeof value.updatedAt !== 'number' ||
    !Number.isSafeInteger(value.updatedAt) ||
    value.updatedAt < 0 ||
    !Array.isArray(value.messages) ||
    !value.messages.length ||
    value.messages.length > 80
  )
    return invalid();
  let size = 0;
  const messages = value.messages.map((message): AIMessage => {
    if (
      !object(message) ||
      (message.role !== 'user' && message.role !== 'model') ||
      typeof message.text !== 'string' ||
      !message.text.trim() ||
      message.text.length > 32_000
    )
      return invalid();
    size += message.text.length;
    return { role: message.role, text: message.text };
  });
  if (size > 128_000) return invalid();
  return { id: value.id, title: value.title, updatedAt: value.updatedAt, messages };
}

/** Local user-data history keyed by canonical workspace, independent of ephemeral project tokens. */
export class AIChatStore {
  private readonly scopes = new Map<string, string>();
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly directory: string,
    private readonly getRoot: (id: string) => string,
  ) {}
  private scope(projectId: unknown): string {
    if (typeof projectId !== 'string' || projectId.length > 256) return invalid();
    let scope = this.scopes.get(projectId);
    if (!scope) {
      const root = this.getRoot(projectId);
      scope = createHash('sha256').update(root).digest('hex');
      this.scopes.set(projectId, scope);
    }
    return scope;
  }
  private async check(scope: string): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directory = await lstat(this.directory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) return invalid();
    const path = join(this.directory, `${scope}.json`);
    try {
      const file = await lstat(path);
      if (!file.isFile() || file.isSymbolicLink() || file.size > MAX_BYTES) return invalid();
    } catch (error) {
      if (!object(error) || error.code !== 'ENOENT') throw error;
    }
    return path;
  }
  private async read(scope: string, waitForWrites = true): Promise<AIStoredChat[]> {
    if (waitForWrites) await this.pending.catch(() => undefined);
    const path = await this.check(scope);
    try {
      const value: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (
        !object(value) ||
        value.version !== 1 ||
        !Array.isArray(value.chats) ||
        value.chats.length > 100
      )
        return invalid();
      const chats = value.chats.map(validateChat);
      if (new Set(chats.map((chat) => chat.id)).size !== chats.length) return invalid();
      return chats.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      if (object(error) && error.code === 'ENOENT') return [];
      return invalid();
    }
  }
  private async write(scope: string, chats: AIStoredChat[]): Promise<void> {
    const content = JSON.stringify({ version: 1, chats });
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) return invalid();
    const temporary = join(this.directory, `.chat-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(content, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      const path = await this.check(scope);
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  async list(projectId: unknown): Promise<AIStoredChat[]> {
    const scope = this.scope(projectId);
    await this.pending.catch(() => undefined);
    return this.read(scope, false);
  }
  save(value: unknown): Promise<void> {
    if (!object(value))
      return Promise.reject(new AIError('AI_CHAT_STORAGE', 'Provide a workspace chat.'));
    const scope = this.scope(value.projectId);
    const chat = validateChat(value.chat);
    const operation = this.pending
      .catch(() => undefined)
      .then(async () => {
        const existing = await this.read(scope, false);
        const previous = existing.find((item) => item.id === chat.id);
        if (previous && previous.updatedAt > chat.updatedAt) return;
        const chats = [chat, ...existing.filter((item) => item.id !== chat.id)]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 100);
        await this.write(scope, chats);
      });
    this.pending = operation;
    return operation;
  }
  deleteChat(value: unknown): Promise<boolean> {
    if (
      !object(value) ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'projectId') ||
      !Object.hasOwn(value, 'chatId') ||
      typeof value.chatId !== 'string' ||
      !/^[A-Za-z0-9-]{1,64}$/.test(value.chatId)
    )
      return Promise.reject(new AIError('AI_CHAT_STORAGE', 'Provide a valid workspace chat ID.'));
    const scope = this.scope(value.projectId);
    const chatId = value.chatId;
    const operation = this.pending
      .catch(() => undefined)
      .then(async () => {
        const existing = await this.read(scope, false);
        const chats = existing.filter((chat) => chat.id !== chatId);
        if (chats.length === existing.length) return false;
        await this.write(scope, chats);
        return true;
      });
    this.pending = operation;
    return operation;
  }
  async flush(): Promise<void> {
    await this.pending.catch(() => undefined);
  }
}
