import { AsyncMutex } from './mutex';
import { writeAtomic } from './atomic-write';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AI_REVIEW_OUTCOMES, type AIReviewOutcome, type AIStoredChat } from '../../shared/ai';
import { AIError } from './ai-service';

const MAX_BYTES = 16 * 1024 * 1024;

function invalid(): never {
  throw new AIError(
    'AI_CHAT_STORAGE',
    'Chat history could not be saved or restored. Existing history was preserved.',
  );
}

const chatMessageSchema = z
  .object({
    role: z.enum(['user', 'model']),
    text: z.string().refine((t) => t.trim().length > 0 && t.length <= 32_000),
    review: z.enum(AI_REVIEW_OUTCOMES).optional(),
  })
  .transform((msg) => {
    const review =
      msg.role === 'model' &&
      msg.review &&
      (AI_REVIEW_OUTCOMES as readonly unknown[]).includes(msg.review)
        ? (msg.review as AIReviewOutcome)
        : undefined;
    return { role: msg.role, text: msg.text, ...(review ? { review } : {}) };
  });

export const storedChatSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
    title: z.string().refine((t) => t.trim().length > 0 && t.length <= 120),
    updatedAt: z.number().int().min(0),
    messages: z.array(chatMessageSchema).min(1).max(80),
  })
  .superRefine((val, ctx) => {
    let size = 0;
    for (const msg of val.messages) {
      size += msg.text.length;
    }
    if (size > 128_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Chat size exceeds limit' });
    }
  });

export const storedChatsFileSchema = z
  .object({
    version: z.literal(1),
    chats: z.array(storedChatSchema).max(100),
  })
  .superRefine((val, ctx) => {
    const ids = new Set(val.chats.map((c) => c.id));
    if (ids.size !== val.chats.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate chat IDs' });
    }
  });

export const saveChatRequestSchema = z.object({
  projectId: z.string().max(256),
  chat: storedChatSchema,
});

export const deleteChatRequestSchema = z
  .object({
    projectId: z.string().max(256),
    chatId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  })
  .strict();

export function validateChat(value: unknown): AIStoredChat {
  const result = storedChatSchema.safeParse(value);
  if (!result.success) return invalid();
  return result.data as AIStoredChat;
}

/** Local user-data history keyed by canonical workspace, independent of ephemeral project tokens. */
export class AIChatStore {
  private readonly scopes = new Map<string, string>();
  private readonly mutex = new AsyncMutex();
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
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        throw error;
    }
    return path;
  }
  private async read(scope: string, waitForWrites = true): Promise<AIStoredChat[]> {
    if (waitForWrites) await this.mutex.flush();
    const path = await this.check(scope);
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      const result = storedChatsFileSchema.safeParse(parsed);
      if (!result.success) return invalid();
      return (result.data.chats as AIStoredChat[]).sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return [];
      return invalid();
    }
  }
  private async write(scope: string, chats: AIStoredChat[]): Promise<void> {
    const content = JSON.stringify({ version: 1, chats });
    if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) return invalid();
    const path = await this.check(scope);
    await writeAtomic(path, content, {
      prefix: 'chat',
      tempDirectory: this.directory,
    });
  }
  async list(projectId: unknown): Promise<AIStoredChat[]> {
    const scope = this.scope(projectId);
    await this.mutex.flush();
    return this.read(scope, false);
  }
  save(value: unknown): Promise<void> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return Promise.reject(new AIError('AI_CHAT_STORAGE', 'Provide a workspace chat.'));
    const candidate = value as Record<string, unknown>;
    const scope = this.scope(candidate.projectId);
    const chat = validateChat(candidate.chat);
    return this.mutex.run(async () => {
      const existing = await this.read(scope, false);
      const previous = existing.find((item) => item.id === chat.id);
      if (previous && previous.updatedAt > chat.updatedAt) return;
      const chats = [chat, ...existing.filter((item) => item.id !== chat.id)]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 100);
      await this.write(scope, chats);
    });
  }
  deleteChat(value: unknown): Promise<boolean> {
    const parsed = deleteChatRequestSchema.safeParse(value);
    if (!parsed.success)
      return Promise.reject(new AIError('AI_CHAT_STORAGE', 'Provide a valid workspace chat ID.'));
    const scope = this.scope(parsed.data.projectId);
    const chatId = parsed.data.chatId;
    return this.mutex.run(async () => {
      const existing = await this.read(scope, false);
      const chats = existing.filter((chat) => chat.id !== chatId);
      if (chats.length === existing.length) return false;
      await this.write(scope, chats);
      return true;
    });
  }
  async flush(): Promise<void> {
    await this.mutex.flush();
  }
}
