import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GeminiService,
  validateAIMessages,
  type GeminiGenerate,
  type KeyCipher,
} from '../../src/main/services/gemini';

// Real authenticated encryption fixture; this does not emulate OS-account binding.
const fixtureKey = randomBytes(32);
const fixtureCipher: KeyCipher = {
  available: () => true,
  encrypt(value) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', fixtureKey, nonce);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  },
  decrypt(value) {
    const decipher = createDecipheriv('aes-256-gcm', fixtureKey, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
  },
};
const firstKey = `AIza${'a'.repeat(35)}`;
const replacementKey = `AIza${'b'.repeat(35)}`;
const question = { messages: [{ role: 'user', text: 'Why is this command undefined?' }] };
const sseText = (text: string): Uint8Array =>
  new TextEncoder().encode(
    `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] })}\n\n`,
  );

function streamFixture() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  return {
    controller,
    response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
  };
}

describe('Gemini local encrypted configuration and request boundaries', () => {
  let directory: string;
  let request: ReturnType<typeof vi.fn<GeminiGenerate>>;
  let service: GeminiService;

  beforeEach(async () => {
    const root = join(process.cwd(), 'test-results', 'gemini');
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(join(root, 'case-'));
    request = vi.fn<GeminiGenerate>().mockResolvedValue('OK');
    service = new GeminiService(directory, fixtureCipher, request);
  });

  afterEach(async () => {
    service.cancel();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('starts unconfigured with auto-send disabled and no settings file', async () => {
    expect(await service.settings()).toEqual({ configured: false, autoSendProblems: false });
    expect(await readdir(directory)).toEqual([]);
    await expect(service.send(question)).rejects.toMatchObject({ code: 'AI_KEY_REQUIRED' });
    expect(request).not.toHaveBeenCalled();
  });

  it('uses the official SDK with only the fixed Google model and bounded text requests', async () => {
    const sent: Request[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const outgoing = new Request(input, init);
      sent.push(outgoing);
      if (outgoing.url.includes(':streamGenerateContent')) {
        const fixture = streamFixture();
        fixture.controller.enqueue(sseText('SDK test response'));
        fixture.controller.close();
        return fixture.response;
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: 'SDK test response' }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const sdkService = new GeminiService(directory, fixtureCipher);
    const settings = await sdkService.saveKey({ apiKey: firstKey });
    expect(JSON.stringify(settings)).not.toContain(firstKey);
    expect(await sdkService.send(question)).toBe('SDK test response');
    expect(sent).toHaveLength(2);
    for (const [index, outgoing] of sent.entries()) {
      const url = new URL(outgoing.url);
      expect(url.origin).toBe('https://generativelanguage.googleapis.com');
      expect(url.pathname).toBe(
        `/v1beta/models/gemini-3.5-flash-lite:${index === 0 ? 'generateContent' : 'streamGenerateContent'}`,
      );
      expect(url.searchParams.get('alt')).toBe(index === 0 ? null : 'sse');
      expect(outgoing.method).toBe('POST');
      expect(outgoing.headers.get('x-goog-api-key')).toBe(firstKey);
      const body = (await outgoing.json()) as {
        contents: { role: string; parts: { text: string }[] }[];
        generationConfig: { maxOutputTokens: number };
        tools?: unknown;
      };
      expect(body.tools).toBeUndefined();
      expect(body.generationConfig.maxOutputTokens).toBe(index === 0 ? 32 : 4096);
      expect(body.contents).toEqual([
        {
          role: 'user',
          parts: [{ text: index === 0 ? 'Reply with OK.' : question.messages[0].text }],
        },
      ]);
      expect(JSON.stringify(body)).not.toContain(firstKey);
    }
  });

  it('publishes cumulative SDK stream text before completion and returns the full response', async () => {
    await service.saveKey({ apiKey: firstKey });
    const fixture = streamFixture();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(fixture.response));
    const sdkService = new GeminiService(directory, fixtureCipher);
    const partials: string[] = [];
    let firstChunk!: () => void;
    const first = new Promise<void>((resolve) => {
      firstChunk = resolve;
    });
    let completed = false;
    const sending = sdkService.send(question, (text) => {
      partials.push(text);
      firstChunk();
    });
    void sending.then(() => {
      completed = true;
    });
    fixture.controller.enqueue(sseText('**Try** '));
    await first;
    expect(completed).toBe(false);
    expect(partials).toEqual(['**Try** ']);
    fixture.controller.enqueue(sseText('this command.'));
    fixture.controller.close();
    expect(await sending).toBe('**Try** this command.');
    expect(partials).toEqual(['**Try** ', '**Try** this command.']);
  });

  it('closes a bounded SDK stream after reaching 32,000 characters', async () => {
    await service.saveKey({ apiKey: firstKey });
    const fixture = streamFixture();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(fixture.response));
    const partials = vi.fn();
    const sending = new GeminiService(directory, fixtureCipher).send(question, partials);
    fixture.controller.enqueue(sseText('a'.repeat(31_999)));
    fixture.controller.enqueue(sseText('overflow'));
    // Leave the stream open: the service must finish without consuming further chunks.
    expect(await sending).toBe(`${'a'.repeat(31_999)}o`);
    expect(partials.mock.calls.map(([text]) => (text as string).length)).toEqual([31_999, 32_000]);
    fixture.controller.close();
  });

  it('rejects an interrupted SDK stream instead of accepting its partial response', async () => {
    await service.saveKey({ apiKey: firstKey });
    const fixture = streamFixture();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(fixture.response));
    let firstChunk!: () => void;
    const first = new Promise<void>((resolve) => {
      firstChunk = resolve;
    });
    const sending = new GeminiService(directory, fixtureCipher).send(question, firstChunk);
    fixture.controller.enqueue(sseText('Partial response'));
    await first;
    fixture.controller.error(new Error(`private provider details ${firstKey}`));
    const error: unknown = await sending.catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'AI_NETWORK' });
    expect(String(error)).not.toContain(firstKey);
    expect(String(error)).not.toContain('private provider details');
  });

  it('stops SDK text delivery immediately when cancelled during a chunk callback', async () => {
    await service.saveKey({ apiKey: firstKey });
    const fixture = streamFixture();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(fixture.response));
    const sdkService = new GeminiService(directory, fixtureCipher);
    const partials: string[] = [];
    const sending = sdkService.send(question, (text) => {
      partials.push(text);
      sdkService.cancel();
    });
    fixture.controller.enqueue(sseText('First'));
    fixture.controller.enqueue(sseText(' second'));
    fixture.controller.close();
    await expect(sending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(partials).toEqual(['First']);
  });

  it.each([null, {}, { apiKey: 1 }, { apiKey: '   ' }, { apiKey: 'a'.repeat(8193) }])(
    'rejects malformed keys before calling Gemini or saving: %j',
    async (value) => {
      await expect(service.saveKey(value)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(request).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual([]);
    },
  );

  it.each(['AQ.fake-test-credential', 'another-key-format', 'x'])(
    'lets Google validate any non-empty credential format (%s)',
    async (key) => {
      await service.saveKey({ apiKey: ` ${key} ` });
      expect(request.mock.lastCall?.[0]).toBe(key);
      const stored = JSON.parse(await readFile(join(directory, 'ai.json'), 'utf8')) as {
        encryptedKey: string;
      };
      expect(fixtureCipher.decrypt(Buffer.from(stored.encryptedKey, 'base64'))).toBe(key);
    },
  );

  it('preserves the saved key when Google rejects a different credential format', async () => {
    await service.saveKey({ apiKey: firstKey });
    const previous = await readFile(join(directory, 'ai.json'), 'utf8');
    request.mockRejectedValueOnce(Object.assign(new Error('invalid credential'), { status: 401 }));
    await expect(service.saveKey({ apiKey: 'AQ.rejected-test-credential' })).rejects.toMatchObject({
      code: 'AI_KEY_INVALID',
    });
    expect(request.mock.lastCall?.[0]).toBe('AQ.rejected-test-credential');
    expect(await readFile(join(directory, 'ai.json'), 'utf8')).toBe(previous);
  });

  it('persists only authenticated ciphertext after testing and decrypts across service instances', async () => {
    expect(await service.saveKey({ apiKey: ` ${firstKey} ` })).toEqual({
      configured: true,
      autoSendProblems: false,
    });
    expect(request).toHaveBeenCalledWith(
      firstKey,
      [{ role: 'user', text: 'Reply with OK.' }],
      expect.any(AbortSignal),
      true,
    );
    const raw = await readFile(join(directory, 'ai.json'), 'utf8');
    expect(raw).not.toContain(firstKey);
    expect(raw).not.toContain('apiKey');
    const stored = JSON.parse(raw) as { encryptedKey: string };
    expect(fixtureCipher.decrypt(Buffer.from(stored.encryptedKey, 'base64'))).toBe(firstKey);
    const restarted = new GeminiService(directory, fixtureCipher, request);
    expect(await restarted.send(question)).toBe('OK');
    expect(request).toHaveBeenLastCalledWith(
      firstKey,
      question.messages,
      expect.any(AbortSignal),
      false,
    );
    expect(await readdir(directory)).toEqual(['ai.json']);
  });

  it('does not publish a key before its verification request finishes', async () => {
    let resolve!: (text: string) => void;
    let started!: () => void;
    const ready = new Promise<void>((done) => {
      started = done;
    });
    request.mockImplementationOnce(() => {
      started();
      return new Promise<string>((done) => {
        resolve = done;
      });
    });
    const saving = service.saveKey({ apiKey: firstKey });
    await ready;
    expect(await service.settings()).toEqual({ configured: false, autoSendProblems: false });
    expect(await readdir(directory)).toEqual([]);
    resolve('OK');
    await saving;
    expect((await service.settings()).configured).toBe(true);
  });

  it.each([
    [429, 'AI_RATE_LIMIT'],
    [401, 'AI_KEY_INVALID'],
    [404, 'AI_MODEL_UNAVAILABLE'],
    [500, 'AI_NETWORK'],
  ])('preserves an existing key and hides provider details on HTTP %i', async (status, code) => {
    await service.saveKey({ apiKey: firstKey });
    const previous = await readFile(join(directory, 'ai.json'), 'utf8');
    request.mockRejectedValueOnce(
      Object.assign(new Error(`provider leaked ${replacementKey}`), { status }),
    );
    const error: unknown = await service
      .saveKey({ apiKey: replacementKey })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain(replacementKey);
    expect(String(error)).not.toContain('provider leaked');
    expect(await readFile(join(directory, 'ai.json'), 'utf8')).toBe(previous);
    await service.send(question);
    expect(request.mock.lastCall?.[0]).toBe(firstKey);
  });

  it('refuses unavailable encryption before testing or persisting credentials', async () => {
    const unavailable = new GeminiService(
      directory,
      { ...fixtureCipher, available: () => false },
      request,
    );
    await expect(unavailable.saveKey({ apiKey: firstKey })).rejects.toMatchObject({
      code: 'AI_STORAGE',
    });
    expect(request).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  });

  it('deletes the single saved key, resets auto-send, and requires setup again after restart', async () => {
    await service.saveKey({ apiKey: firstKey });
    await service.setAutoSend({ autoSendProblems: true });
    request.mockClear();
    expect(await service.deleteKey()).toEqual({ configured: false, autoSendProblems: false });
    expect(request).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(directory, 'ai.json'), 'utf8'))).toEqual({
      version: 1,
      encryptedKey: '',
      autoSendProblems: false,
    });
    const restarted = new GeminiService(directory, fixtureCipher, request);
    expect(await restarted.settings()).toEqual({ configured: false, autoSendProblems: false });
    await expect(restarted.send(question)).rejects.toMatchObject({ code: 'AI_KEY_REQUIRED' });
    await restarted.saveKey({ apiKey: replacementKey });
    const saved = JSON.parse(await readFile(join(directory, 'ai.json'), 'utf8')) as {
      encryptedKey: string;
    };
    expect(fixtureCipher.decrypt(Buffer.from(saved.encryptedKey, 'base64'))).toBe(replacementKey);
    expect(await readdir(directory)).toEqual(['ai.json']);
  });

  it('can remove an encrypted key when OS decryption is unavailable', async () => {
    await service.saveKey({ apiKey: firstKey });
    const unavailable = new GeminiService(
      directory,
      {
        ...fixtureCipher,
        available: () => false,
        decrypt: () => {
          throw new Error('unavailable');
        },
      },
      request,
    );
    expect(await unavailable.deleteKey()).toEqual({ configured: false, autoSendProblems: false });
    expect(await unavailable.deleteKey()).toEqual({ configured: false, autoSendProblems: false });
  });

  it('replaces the saved key rather than retaining additional credentials', async () => {
    await service.saveKey({ apiKey: firstKey });
    const previous = JSON.parse(await readFile(join(directory, 'ai.json'), 'utf8')) as {
      encryptedKey: string;
    };
    await service.saveKey({ apiKey: replacementKey });
    const raw = await readFile(join(directory, 'ai.json'), 'utf8');
    const saved = JSON.parse(raw) as { encryptedKey: string };
    expect(fixtureCipher.decrypt(Buffer.from(saved.encryptedKey, 'base64'))).toBe(replacementKey);
    expect(raw).not.toContain(previous.encryptedKey);
    expect(await readdir(directory)).toEqual(['ai.json']);
  });

  it('persists auto-send explicitly without exposing or replacing the credential', async () => {
    await service.saveKey({ apiKey: firstKey });
    const previous = JSON.parse(await readFile(join(directory, 'ai.json'), 'utf8')) as {
      encryptedKey: string;
    };
    await service.setAutoSend({ autoSendProblems: true });
    const restarted = new GeminiService(directory, fixtureCipher, request);
    expect(await restarted.settings()).toEqual({ configured: true, autoSendProblems: true });
    const current = JSON.parse(await readFile(join(directory, 'ai.json'), 'utf8')) as {
      encryptedKey: string;
    };
    expect(current.encryptedKey).toBe(previous.encryptedKey);
    await expect(service.setAutoSend({ autoSendProblems: 'true' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    expect((await restarted.settings()).autoSendProblems).toBe(true);
  });

  it.each(['{broken', '{"version":99,"encryptedKey":"","autoSendProblems":false}'])(
    'preserves invalid local settings: %s',
    async (raw) => {
      await writeFile(join(directory, 'ai.json'), raw);
      await expect(service.settings()).rejects.toMatchObject({ code: 'AI_STORAGE' });
      await expect(service.setAutoSend({ autoSendProblems: true })).rejects.toMatchObject({
        code: 'AI_STORAGE',
      });
      await expect(service.deleteKey()).rejects.toMatchObject({ code: 'AI_STORAGE' });
      expect(await readFile(join(directory, 'ai.json'), 'utf8')).toBe(raw);
    },
  );

  it('does not call Gemini when an encrypted key cannot be decrypted', async () => {
    await service.saveKey({ apiKey: firstKey });
    const broken = new GeminiService(
      directory,
      {
        ...fixtureCipher,
        decrypt() {
          throw new Error(`private decrypt details ${firstKey}`);
        },
      },
      request,
    );
    request.mockClear();
    await expect(broken.send(question)).rejects.toMatchObject({ code: 'AI_STORAGE' });
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects concurrent sends and settings changes, cancels, then permits retry', async () => {
    await service.saveKey({ apiKey: firstKey });
    let started!: () => void;
    const ready = new Promise<void>((done) => {
      started = done;
    });
    request.mockImplementationOnce((_key, _messages, signal) => {
      started();
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const sending = service.send(question);
    await ready;
    await expect(service.send(question)).rejects.toMatchObject({ code: 'AI_BUSY' });
    await expect(service.setAutoSend({ autoSendProblems: true })).rejects.toMatchObject({
      code: 'AI_BUSY',
    });
    await expect(service.saveKey({ apiKey: replacementKey })).rejects.toMatchObject({
      code: 'AI_BUSY',
    });
    await expect(service.deleteKey()).rejects.toMatchObject({ code: 'AI_BUSY' });
    service.cancel();
    await expect(sending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(await service.send(question)).toBe('OK');
  });

  it('cancels immediately before the asynchronous key read can start a request', async () => {
    await service.saveKey({ apiKey: firstKey });
    expect(request).toHaveBeenCalledTimes(1);
    const sending = service.send(question);
    service.cancel();
    await expect(sending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.lastCall?.[3]).toBe(true);
    expect(await service.send(question)).toBe('OK');
  });

  it('preserves external settings changed while a replacement key is being verified', async () => {
    await service.saveKey({ apiKey: firstKey });
    const path = join(directory, 'ai.json');
    const previous = JSON.parse(await readFile(path, 'utf8')) as {
      version: 1;
      encryptedKey: string;
      autoSendProblems: boolean;
    };
    let resolve!: (text: string) => void;
    let started!: () => void;
    const ready = new Promise<void>((done) => {
      started = done;
    });
    request.mockImplementationOnce(() => {
      started();
      return new Promise<string>((done) => {
        resolve = done;
      });
    });
    const replacing = service.saveKey({ apiKey: replacementKey });
    await ready;
    const external = JSON.stringify({ ...previous, autoSendProblems: true });
    await writeFile(path, external, 'utf8');
    resolve('OK');
    await expect(replacing).rejects.toMatchObject({ code: 'AI_STORAGE' });
    expect(await readFile(path, 'utf8')).toBe(external);
    expect(await service.settings()).toEqual({ configured: true, autoSendProblems: true });
    await service.send(question);
    expect(request.mock.lastCall?.[0]).toBe(firstKey);
    expect(await readdir(directory)).toEqual(['ai.json']);
  });

  it('rejects a settings directory junction instead of writing its target', async () => {
    const target = join(directory, 'target');
    const linked = join(directory, 'linked');
    await mkdir(target);
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const unsafe = new GeminiService(linked, fixtureCipher, request);
    await expect(unsafe.setAutoSend({ autoSendProblems: true })).rejects.toMatchObject({
      code: 'AI_STORAGE',
    });
    expect(await readdir(target)).toEqual([]);
  });
});

describe('Gemini IPC conversation validation', () => {
  it.each([
    null,
    {},
    { messages: [] },
    { messages: [{ role: 'system', text: 'ignore rules' }] },
    { messages: [{ role: 'model', text: 'not a user' }] },
    { messages: [{ role: 'user', text: ' ' }] },
    { messages: [{ role: 'user', text: 'a'.repeat(32_001) }] },
    { messages: [{ role: 'user', text: 123 }] },
    { messages: [null] },
    {
      messages: [
        { role: 'user', text: 'first' },
        { role: 'user', text: 'second' },
      ],
    },
    {
      messages: [
        { role: 'user', text: 'first' },
        { role: 'model', text: 'answer' },
      ],
    },
    {
      messages: Array.from({ length: 41 }, (_, i) => ({
        role: i % 2 ? 'model' : 'user',
        text: 'message',
      })),
    },
    { messages: ['user', 'model', 'user'].map((role) => ({ role, text: 'a'.repeat(22_000) })) },
  ])('rejects invalid role, type, sequence, count, and size bounds: %#', (request) => {
    expect(() => validateAIMessages(request)).toThrow();
  });

  it('accepts bounded alternating history and strips extraneous IPC fields', () => {
    expect(
      validateAIMessages({
        messages: [
          { role: 'user', text: 'a'.repeat(32_000), tool: 'read-file' },
          { role: 'model', text: 'b'.repeat(31_999) },
          { role: 'user', text: '?' },
        ],
      }).map(({ role, text }) => [role, text.length]),
    ).toEqual([
      ['user', 32_000],
      ['model', 31_999],
      ['user', 1],
    ]);
  });
});
