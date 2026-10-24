import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIService } from '../../src/main/services/ai-service';
import {
  AIInlineEditService,
  INLINE_EDIT_SYSTEM_PROMPT,
  normalizeInlineEdit,
  validateInlineEditRequest,
} from '../../src/main/services/ai-inline-edit';
import type { AIInlineEditRequest } from '../../src/shared/ai';
import type { ChatRequest, ProviderAccess } from '../../src/main/services/ai-providers';

const request: AIInlineEditRequest = {
  requestId: 'edit-one',
  model: { provider: 'ollama-local', model: 'qwen2.5-coder:0.5b' },
  projectId: 'fixture',
  path: 'main.tex',
  revision: 'revision',
  modelVersion: 3,
  offset: 6,
  endOffset: 9,
  prefix: 'before',
  suffix: 'after',
  selection: 'old',
  instruction: 'Replace with a labeled equation',
  metadata: '{}',
};

describe('prompted inline edit contract', () => {
  it('requires an explicit bounded instruction and a coherent source range', () => {
    expect(() => validateInlineEditRequest(request)).not.toThrow();
    for (const invalid of [
      { ...request, instruction: '' },
      { ...request, instruction: 'x'.repeat(4001) },
      { ...request, selection: 'x'.repeat(16001) },
      { ...request, endOffset: 10 },
      { ...request, prefix: 'x'.repeat(16001), offset: 20000, endOffset: 20003 },
    ]) {
      expect(() => validateInlineEditRequest(invalid)).toThrow();
    }
  });
  it('unwraps output and preserves replacement indentation and line endings', () => {
    expect(
      normalizeInlineEdit('```latex\n  new\n    nested\n```', { ...request, selection: 'old\r\n' }),
    ).toBe('  new\r\n    nested');
    expect(normalizeInlineEdit('beforeNEWafter', request)).toBe('NEW');
    expect(() => normalizeInlineEdit('', request)).toThrow();
    expect(() => normalizeInlineEdit('x'.repeat(32001), request)).toThrow();
  });
});

describe('main-owned inline edits', () => {
  let directory: string;
  let ai: AIService;
  let edits: AIInlineEditService;
  const generate =
    vi.fn<(access: ProviderAccess, model: string, request: ChatRequest) => Promise<string>>();
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'textra-inline-edit-'));
    generate.mockReset().mockResolvedValue('new');
    ai = new AIService(
      directory,
      { available: () => true, encrypt: (key) => Buffer.from(key), decrypt: (v) => v.toString() },
      {
        list: async () => [
          {
            id: request.model.model,
            label: 'Fixture',
            capabilities: { chat: true, completion: true, transport: 'ollama-generate' },
          },
        ],
      },
    );
    await ai.saveProvider({ provider: 'ollama-local' });
    edits = new AIInlineEditService(ai, generate);
  });
  afterEach(async () => {
    ai.cancel();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  it('uses shared instructions, no history/tools and echoes guarded replacement identity', async () => {
    expect(await edits.request(request)).toEqual({
      requestId: 'edit-one',
      modelVersion: 3,
      offset: 6,
      endOffset: 9,
      text: 'new',
    });
    const sent = generate.mock.calls[0][2];
    expect(sent).toMatchObject({
      system: INLINE_EDIT_SYSTEM_PROMPT,
      maxTokens: 4096,
      exactTokenBudget: true,
    });
    expect(sent.messages).toHaveLength(1);
    expect(JSON.parse(sent.messages[0].text)).toMatchObject({
      instruction: request.instruction,
      selection: 'old',
    });
    expect(sent).not.toHaveProperty('tools');
  });
  it('cancels request-specifically and remembers cancellation before routing', async () => {
    edits.cancel({ requestId: request.requestId });
    await expect(edits.request(request)).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(generate).not.toHaveBeenCalled();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    generate.mockImplementationOnce(async () => {
      started();
      return new Promise(() => undefined);
    });
    const pending = edits.request({ ...request, requestId: 'edit-two' });
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    await ready;
    edits.cancel({ requestId: 'unrelated' });
    expect(generate.mock.calls[0][2].signal.aborted).toBe(false);
    edits.cancel({ requestId: 'edit-two' });
    await cancelled;
    expect(generate.mock.calls[0][2].signal.aborted).toBe(true);
  });

  it('workspace cancellation aborts an active edit through the foreground owner', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    generate.mockImplementationOnce(async () => {
      started();
      return new Promise<string>(() => undefined);
    });
    const pending = edits.request(request);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    await ready;
    ai.cancelAll();
    await rejected;
    expect(generate.mock.calls[0][2].signal.aborted).toBe(true);
    await expect(edits.request({ ...request, requestId: 'fresh-edit' })).resolves.toMatchObject({
      text: 'new',
    });
  });
  it('streams cumulative raw output and normalizes only the final result', async () => {
    const chunks: string[] = [];
    generate.mockImplementationOnce(async (_access, _model, sent) => {
      sent.onText?.('```latex\n  new');
      sent.onText?.('```latex\n  new\n```');
      return '```latex\n  new\n```';
    });
    const result = await edits.request(request, (text) => chunks.push(text));
    expect(chunks).toEqual(['```latex\n  new', '```latex\n  new\n```']);
    expect(result.text).toBe('  new');
  });
  it('rejects oversized streamed output before publishing it', async () => {
    const chunk = vi.fn();
    generate.mockImplementationOnce(async (_access, _model, sent) => {
      sent.onText?.('x'.repeat(32_001));
      return 'unused';
    });
    await expect(edits.request(request, chunk)).rejects.toMatchObject({
      code: 'AI_INLINE_EDIT_OUTPUT',
    });
    expect(chunk).not.toHaveBeenCalled();
  });
  it('ignores late chunks from aborted or completed generators', async () => {
    let send: ((text: string) => void) | undefined;
    generate.mockImplementationOnce(async (_access, _model, sent) => {
      send = sent.onText;
      return 'finished';
    });
    const chunk = vi.fn();
    await edits.request(request, chunk);
    send?.('late');
    expect(chunk).not.toHaveBeenCalled();
  });
  it('reports busy without interrupting foreground Chat/Agent work', async () => {
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = ai.withProvider(request.model, async () => {
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    await ready;
    await expect(edits.request(request)).rejects.toMatchObject({ code: 'AI_BUSY' });
    expect(generate).not.toHaveBeenCalled();
    finish();
    await held;
  });
  it('bounds unresponsive edits to sixty seconds and releases foreground coordination', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    generate.mockImplementationOnce(async () => {
      started();
      return new Promise(() => undefined);
    });
    vi.useFakeTimers();
    try {
      const pending = edits.request(request);
      const timedOut = expect(pending).rejects.toMatchObject({ code: 'AI_INLINE_EDIT_TIMEOUT' });
      await ready;
      await vi.advanceTimersByTimeAsync(60_000);
      await timedOut;
      expect(await edits.request({ ...request, requestId: 'edit-after-timeout' })).toHaveProperty(
        'text',
        'new',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
