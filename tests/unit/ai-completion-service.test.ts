import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AIService,
  normalizeCompletion,
  validateCompletionRequest,
  type KeyCipher,
} from '../../src/main/services/ai-service';
import { type CompletionGenerateRequest } from '../../src/main/services/ai-providers';
import { type AICompletionRequest } from '../../src/shared/ai';

const cipher: KeyCipher = {
  available: () => true,
  encrypt: (key) => Buffer.from(key),
  decrypt: (value) => value.toString(),
};
const snapshot: AICompletionRequest = {
  requestId: 'manual-1',
  role: 'inlineCompletion',
  model: { provider: 'ollama-local', model: 'qwen2.5-coder:3b' },
  projectId: 'project',
  path: 'main.tex',
  revision: 'disk-version',
  modelVersion: 2,
  offset: 6,
  prefix: 'before',
  suffix: 'after',
  metadata: 'language=latex',
};

describe('bounded completion output and request validation', () => {
  it('accepts exactly the bounded active buffer fields', () => {
    expect(() => validateCompletionRequest(snapshot)).not.toThrow();
    for (const value of [
      { ...snapshot, prefix: 'x'.repeat(16001), offset: 16001 },
      { ...snapshot, suffix: 'x'.repeat(4001) },
      { ...snapshot, metadata: 'x'.repeat(4001) },
      { ...snapshot, modelVersion: 0 },
      { ...snapshot, offset: 2 },
      { ...snapshot, path: 'main.bib' },
      { ...snapshot, role: 'completion', prefix: 'x'.repeat(8001), offset: 8001 },
    ])
      expect(() => validateCompletionRequest(value)).toThrow();
  });
  it('removes wrapping fences, exact echoed context and duplicated suffix without altering indentation', () => {
    expect(normalizeCompletion('```latex\nbeforesome textafter\n```', snapshot)).toBe('some text');
    expect(normalizeCompletion('  next\n    nested', { ...snapshot, prefix: 'before\r\n' })).toBe(
      '  next\r\n    nested',
    );
    expect(
      normalizeCompletion('continuation\\end', { ...snapshot, suffix: '\\end{equation}' }),
    ).toBe('continuation');
  });
  it('rejects empty, oversized and excessive-line outputs', () => {
    for (const text of ['', 'after', 'x'.repeat(20001), Array(21).fill('line').join('\n')])
      expect(() => normalizeCompletion(text, snapshot)).toThrow();
    expect(
      normalizeCompletion(Array(10).fill('line').join('\n'), {
        ...snapshot,
        role: 'completion',
      }).split('\n'),
    ).toHaveLength(10);
    expect(() =>
      normalizeCompletion(Array(11).fill('line').join('\n'), { ...snapshot, role: 'completion' }),
    ).toThrow();
  });
});

describe('completion service coordination', () => {
  let directory: string;
  let service: AIService;
  let generate: ReturnType<
    typeof vi.fn<
      (access: unknown, model: string, request: CompletionGenerateRequest) => Promise<string>
    >
  >;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'textra-ai-completion-'));
    generate = vi.fn<
      (access: unknown, model: string, request: CompletionGenerateRequest) => Promise<string>
    >(async () => 'insertion');
    service = new AIService(directory, cipher, {
      list: async () => [
        {
          id: 'qwen2.5-coder:3b',
          label: 'Qwen',
          capabilities: { chat: true, completion: true, transport: 'ollama-generate' },
        },
      ],
      completion: generate,
      confirmAutomatic: async () => true,
    });
    await service.saveProvider({ provider: 'ollama-local' });
  });
  afterEach(async () => {
    service.cancelCompletion({ requestId: 'manual-1' });
    service.cancelCompletion({ requestId: 'automatic-1' });
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  it('echoes insertion identity and sends only bounded context with the manual budget', async () => {
    expect(await service.complete(snapshot)).toEqual({
      requestId: 'manual-1',
      modelVersion: 2,
      offset: 6,
      text: 'insertion',
    });
    expect(generate.mock.calls[0][2]).toMatchObject({
      prefix: 'before',
      suffix: 'after',
      metadata: 'language=latex',
      maxTokens: 512,
      transport: 'ollama-generate',
    });
  });
  it('refuses automatic completion until consent and uses its small budget after enable', async () => {
    const automatic = { ...snapshot, role: 'completion' as const, requestId: 'automatic-1' };
    await expect(service.complete(automatic)).rejects.toMatchObject({
      code: 'AI_CONSENT_REQUIRED',
    });
    expect(generate).not.toHaveBeenCalled();
    await service.setCompletionSettings({ enabled: true, allowOutsideEnvironments: false });
    await service.complete(automatic);
    expect(generate.mock.calls[0][2]).toMatchObject({ maxTokens: 384, maxLines: 10 });
  });
  it('remembers cancellation that arrives before canonical path validation finishes', async () => {
    service.cancelCompletion({ requestId: snapshot.requestId });
    await expect(service.complete(snapshot)).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(generate).not.toHaveBeenCalled();
  });
  it('cancels only the matching request and does not interrupt an unrelated request', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    generate.mockImplementationOnce(async () => {
      started();
      return new Promise<string>(() => undefined);
    });
    const pending = service.complete(snapshot);
    await ready;
    const signal = generate.mock.calls[0][2].signal;
    service.cancelCompletion({ requestId: 'different-request' });
    expect(signal.aborted).toBe(false);
    service.cancelCompletion({ requestId: snapshot.requestId });
    await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(signal.aborted).toBe(true);
  });

  it.each(['completion', 'inlineCompletion'] as const)(
    'workspace cancellation aborts %s and allows a fresh request after cleanup',
    async (role) => {
      await service.setCompletionSettings({ enabled: true, allowOutsideEnvironments: false });
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      generate.mockImplementationOnce(async () => {
        started();
        return new Promise<string>(() => undefined);
      });
      const pending = service.complete({ ...snapshot, role });
      const rejected = expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
      await ready;
      service.cancelAll();
      await rejected;
      expect(generate.mock.calls[0][2].signal.aborted).toBe(true);
      await expect(
        service.complete({ ...snapshot, role, requestId: 'fresh-request' }),
      ).resolves.toMatchObject({ text: 'insertion' });
    },
  );

  it('workspace cancellation revokes foreground resolution before provider generation starts', async () => {
    const action = vi.fn(async () => 'should never send');
    const pending = service.withProvider(snapshot.model, action);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    service.cancelAll();
    await rejected;
    expect(action).not.toHaveBeenCalled();
  });
  it('revokes pending completion when its configuration changes', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    generate.mockImplementationOnce(async () => {
      started();
      return new Promise<string>(() => undefined);
    });
    const pending = service.complete(snapshot);
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    await ready;
    await service.setRoleDefault({ role: 'inlineCompletion', model: null });
    await cancelled;
    expect(generate.mock.calls[0][2].signal.aborted).toBe(true);
  });
  it('lets the Assistant preempt automatic work and lets Ctrl+I preempt automatic work', async () => {
    await service.setCompletionSettings({ enabled: true, allowOutsideEnvironments: false });
    for (const foreground of ['chat', 'inline'] as const) {
      let started!: () => void;
      const ready = new Promise<void>((resolve) => (started = resolve));
      generate.mockImplementationOnce(async () => {
        started();
        return new Promise<string>(() => undefined);
      });
      const pending = service.complete({
        ...snapshot,
        role: 'completion',
        requestId: 'automatic-1',
      });
      const cancelled = expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
      await ready;
      if (foreground === 'chat')
        await service.withProvider(snapshot.model, async () => 'Assistant response');
      else await service.complete(snapshot);
      await cancelled;
    }
  });
  it('reports busy for Ctrl+I while a foreground Assistant request is active', async () => {
    let started!: () => void;
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const foreground = service.withProvider(snapshot.model, async () => {
      started();
      await gate;
    });
    await ready;
    await expect(service.complete(snapshot)).rejects.toMatchObject({ code: 'AI_BUSY' });
    expect(generate).not.toHaveBeenCalled();
    finish();
    await foreground;
  });
  it('does not let the Assistant interrupt an active manual completion', async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    generate.mockImplementationOnce(async () => {
      started();
      return new Promise<string>(() => undefined);
    });
    const pending = service.complete(snapshot);
    await ready;
    await expect(
      service.withProvider(snapshot.model, async () => 'Assistant response'),
    ).rejects.toMatchObject({ code: 'AI_BUSY' });
    expect(generate.mock.calls[0][2].signal.aborted).toBe(false);
    service.cancelCompletion({ requestId: snapshot.requestId });
    await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
  });
  it.each([
    ['completion', 30000],
    ['inlineCompletion', 30000],
  ] as const)('times out %s requests after their bounded deadline', async (role, deadline) => {
    await service.setCompletionSettings({ enabled: true, allowOutsideEnvironments: false });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    generate.mockImplementationOnce(async () => {
      started();
      return new Promise<string>(() => undefined);
    });
    vi.useFakeTimers();
    try {
      const pending = service.complete({ ...snapshot, role });
      const cancelled = expect(pending).rejects.toMatchObject({ code: 'AI_COMPLETION_TIMEOUT' });
      await ready;
      await vi.advanceTimersByTimeAsync(deadline);
      await cancelled;
    } finally {
      vi.useRealTimers();
    }
  });
});
