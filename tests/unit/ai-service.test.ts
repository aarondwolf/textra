import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  AIService,
  type ChatGenerate,
  type KeyCipher,
  type ModelLister,
  type OllamaLauncher,
} from '../../src/main/services/ai-service';
import { ProviderHTTPError } from '../../src/main/services/ai-providers';
import type { AIModelInfo, AIProviderId } from '../../src/shared/ai';

// Reversible fixture cipher only; production uses OS-account encryption (safeStorage).
const cipher: KeyCipher = {
  available: () => true,
  encrypt: (key) => Buffer.from([...key].reverse().join('')),
  decrypt: (key) => [...key.toString()].reverse().join(''),
};
const MODELS: Record<AIProviderId, AIModelInfo[]> = {
  google: [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
  ],
  openai: [
    { id: 'gpt-5', label: 'gpt-5' },
    { id: 'gpt-5-mini', label: 'gpt-5-mini' },
  ],
  anthropic: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  ],
  'ollama-cloud': [{ id: 'gpt-oss:120b', label: 'gpt-oss:120b' }],
  'ollama-local': [{ id: 'llama3.2:latest', label: 'llama3.2' }],
};
const question = { messages: [{ role: 'user', text: 'Why is \\foo undefined?' }] };

describe('multi-provider AI settings and requests', () => {
  let directory: string;
  let list: ReturnType<typeof vi.fn<ModelLister>>;
  let chat: ReturnType<typeof vi.fn<ChatGenerate>>;
  let ollama: {
    find: Mock<OllamaLauncher['find']>;
    start: Mock<OllamaLauncher['start']>;
    version: Mock<OllamaLauncher['version']>;
  };
  let service: AIService;
  beforeEach(async () => {
    const root = join(process.cwd(), 'test-results', 'ai-service');
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(join(root, 'case-'));
    list = vi.fn<ModelLister>(async ({ provider }) => MODELS[provider]);
    chat = vi.fn<ChatGenerate>(async (_access, _model, request) => {
      request.onText?.('Load the package.');
      return 'Load the package.';
    });
    ollama = {
      find: vi.fn<OllamaLauncher['find']>(async () => '/usr/local/bin/ollama'),
      start: vi.fn<OllamaLauncher['start']>(),
      version: vi.fn<OllamaLauncher['version']>(async () => null),
    };
    service = new AIService(directory, cipher, { list, chat, ollama });
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('starts unconfigured with every provider listed', async () => {
    const settings = await service.settings();
    expect(settings.configured).toBe(false);
    expect(settings.defaultModel).toBeNull();
    expect(settings.providers.map(({ id }) => id)).toEqual([
      'google',
      'openai',
      'anthropic',
      'ollama-cloud',
      'ollama-local',
    ]);
  });

  it('tests a key by listing models, encrypts it, and picks sensible defaults', async () => {
    const settings = await service.saveProvider({ provider: 'google', apiKey: '  google-secret ' });
    expect(list).toHaveBeenCalledWith(
      { provider: 'google', key: 'google-secret' },
      expect.any(AbortSignal),
    );
    expect(settings.configured).toBe(true);
    expect(settings.defaultModel).toEqual({ provider: 'google', model: 'gemini-3.5-flash-lite' });
    const google = settings.providers.find(({ id }) => id === 'google')!;
    expect(google.models).toEqual(MODELS.google);
    expect(google.defaultModel).toBe('gemini-3.5-flash-lite');
    const raw = await readFile(join(directory, 'ai.json'), 'utf8');
    expect(raw).not.toContain('google-secret');
    expect(JSON.stringify(settings)).not.toContain('google-secret');
  });

  it('keeps the overall default when more providers are added, and lets the user change it', async () => {
    await service.saveProvider({ provider: 'google', apiKey: 'g' });
    let settings = await service.saveProvider({ provider: 'anthropic', apiKey: 'a' });
    expect(settings.defaultModel?.provider).toBe('google');
    expect(settings.providers.find(({ id }) => id === 'anthropic')!.defaultModel).toBe(
      'claude-haiku-5-5',
    );
    settings = await service.setDefaultModel({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(settings.defaultModel).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    settings = await service.setProviderDefault({ provider: 'google', model: 'gemini-3.8-flash' });
    expect(settings.providers.find(({ id }) => id === 'google')!.defaultModel).toBe(
      'gemini-3.8-flash',
    );
    await expect(
      service.setDefaultModel({ provider: 'openai', model: 'gpt-5' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      service.setProviderDefault({ provider: 'google', model: 'unlisted' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('falls back to another provider when the default provider is removed', async () => {
    await service.saveProvider({ provider: 'openai', apiKey: 'o' });
    await service.saveProvider({ provider: 'anthropic', apiKey: 'a' });
    const settings = await service.removeProvider({ provider: 'openai' });
    expect(settings.defaultModel).toEqual({ provider: 'anthropic', model: 'claude-haiku-5-5' });
    expect(settings.providers.find(({ id }) => id === 'openai')!.configured).toBe(false);
    expect((await service.removeProvider({ provider: 'anthropic' })).configured).toBe(false);
  });

  it('serializes concurrent provider saves without losing either one', async () => {
    await Promise.all([
      service.saveProvider({ provider: 'openai', apiKey: 'o' }),
      service.saveProvider({ provider: 'anthropic', apiKey: 'a' }),
      service.saveProvider({ provider: 'ollama-cloud', apiKey: 'c' }),
    ]);
    const settings = await service.settings();
    expect(settings.providers.filter(({ configured }) => configured)).toHaveLength(3);
  });

  it('sends chat to the chosen provider with its decrypted key and streams text', async () => {
    await service.saveProvider({ provider: 'openai', apiKey: 'openai-secret' });
    const partials: string[] = [];
    const text = await service.send(
      { ...question, model: { provider: 'openai', model: 'gpt-5-mini' } },
      (partial) => partials.push(partial),
    );
    expect(text).toBe('Load the package.');
    expect(partials).toEqual(['Load the package.']);
    const [access, model, request] = chat.mock.calls[0];
    expect(access).toEqual({ provider: 'openai', key: 'openai-secret' });
    expect(model).toBe('gpt-5-mini');
    expect(request.system).toContain('LaTeX');
    expect(request.messages).toEqual(question.messages);
  });

  it('refuses unlisted models and unconfigured providers before any request', async () => {
    await service.saveProvider({ provider: 'openai', apiKey: 'o' });
    await expect(
      service.send({ ...question, model: { provider: 'openai', model: 'gpt-9' } }),
    ).rejects.toMatchObject({ code: 'AI_MODEL_UNAVAILABLE' });
    await expect(
      service.send({ ...question, model: { provider: 'anthropic', model: 'claude-haiku-5-5' } }),
    ).rejects.toMatchObject({ code: 'AI_KEY_REQUIRED' });
    await expect(
      service.send({ ...question, model: { provider: 'evil', model: 'x' } }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      service.send({ ...question, model: { provider: 'openai', model: '../x' } }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(chat).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'AI_KEY_INVALID'],
    [404, 'AI_MODEL_UNAVAILABLE'],
    [429, 'AI_RATE_LIMIT'],
    [400, 'AI_REQUEST_REJECTED'],
    [500, 'AI_PROVIDER_ERROR'],
  ])('maps HTTP %i to %s without leaking the key', async (status, code) => {
    await service.saveProvider({ provider: 'anthropic', apiKey: 'sk-ant-secret-value-123456' });
    chat.mockRejectedValueOnce(
      new ProviderHTTPError(status, 'bad key sk-ant-secret-value-123456 for this model'),
    );
    const error = await service
      .send({ ...question, model: { provider: 'anthropic', model: 'claude-haiku-5-5' } })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code });
    expect(String((error as Error).message)).not.toContain('secret-value');
    expect(String((error as Error).message)).toContain('Anthropic');
  });

  it('reports a rejected key during setup and saves nothing', async () => {
    list.mockRejectedValueOnce(new ProviderHTTPError(401, 'invalid x-api-key'));
    await expect(
      service.saveProvider({ provider: 'anthropic', apiKey: 'wrong' }),
    ).rejects.toMatchObject({ code: 'AI_KEY_INVALID' });
    expect((await service.settings()).providers.some(({ configured }) => configured)).toBe(false);
  });

  it('records a refresh failure on the provider card and keeps the cached list', async () => {
    await service.saveProvider({ provider: 'openai', apiKey: 'o' });
    list.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(service.refreshModels({ provider: 'openai' })).rejects.toMatchObject({
      code: 'AI_NETWORK',
    });
    const openai = (await service.settings()).providers.find(({ id }) => id === 'openai')!;
    expect(openai.error).toContain('could not be reached');
    expect(openai.models).toEqual(MODELS.openai);
    list.mockResolvedValueOnce([{ id: 'gpt-6', label: 'gpt-6' }]);
    const refreshed = await service.refreshModels({ provider: 'openai' });
    const updated = refreshed.providers.find(({ id }) => id === 'openai')!;
    expect(updated).toMatchObject({ error: null, defaultModel: 'gpt-6' });
    expect(refreshed.defaultModel).toEqual({ provider: 'openai', model: 'gpt-6' });
  });

  it('uses local Ollama without a key or OS encryption', async () => {
    const plain = new AIService(
      directory,
      { ...cipher, available: () => false },
      { list, chat, ollama },
    );
    await expect(plain.saveProvider({ provider: 'openai', apiKey: 'o' })).rejects.toMatchObject({
      code: 'AI_STORAGE',
    });
    const settings = await plain.saveProvider({ provider: 'ollama-local' });
    expect(settings.defaultModel).toEqual({ provider: 'ollama-local', model: 'llama3.2:latest' });
    await plain.send({ ...question, model: settings.defaultModel });
    expect(chat.mock.calls[0][0]).toEqual({ provider: 'ollama-local', key: null });
  });

  it('explains an empty local Ollama model list', async () => {
    list.mockResolvedValueOnce([]);
    await expect(service.saveProvider({ provider: 'ollama-local' })).rejects.toMatchObject({
      code: 'AI_NO_MODELS',
      message: expect.stringContaining('ollama pull'),
    });
  });

  it('detects and starts local Ollama with a fixed command', async () => {
    expect(await service.ollamaStatus()).toEqual({
      running: false,
      version: null,
      installed: true,
    });
    ollama.version
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue('0.13.0');
    const status = await service.startOllama();
    expect(ollama.start).toHaveBeenCalledWith('/usr/local/bin/ollama');
    expect(status).toEqual({ running: true, version: '0.13.0', installed: true });
    expect(await service.startOllama()).toMatchObject({ running: true });
    expect(ollama.start).toHaveBeenCalledTimes(1);
  });

  it('reports a missing Ollama installation instead of starting anything', async () => {
    ollama.find.mockResolvedValue(null);
    expect(await service.ollamaStatus()).toMatchObject({ running: false, installed: false });
    await expect(service.startOllama()).rejects.toMatchObject({ code: 'AI_OLLAMA_MISSING' });
    expect(ollama.start).not.toHaveBeenCalled();
  });

  it('migrates the single-key v1 file to the Google provider', async () => {
    await writeFile(
      join(directory, 'ai.json'),
      JSON.stringify({
        version: 1,
        encryptedKey: cipher.encrypt('old-key').toString('base64'),
        autoSendProblems: true,
      }),
    );
    let settings = await service.settings();
    expect(settings.autoSendProblems).toBe(true);
    expect(settings.providers.find(({ id }) => id === 'google')!.configured).toBe(true);
    expect(settings.configured).toBe(false);
    settings = await service.refreshModels({ provider: 'google' });
    expect(list.mock.calls.at(-1)?.[0]).toEqual({ provider: 'google', key: 'old-key' });
    expect(settings.configured).toBe(true);
  });

  it('preserves an invalid or newer settings file', async () => {
    const file = join(directory, 'ai.json');
    await writeFile(file, JSON.stringify({ version: 3, autoSendProblems: false, providers: {} }));
    await expect(service.settings()).rejects.toMatchObject({ code: 'AI_STORAGE' });
    await expect(service.saveProvider({ provider: 'openai', apiKey: 'o' })).rejects.toMatchObject({
      code: 'AI_STORAGE',
    });
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(3);
  });

  it('allows one request at a time and cancels the active one', async () => {
    await service.saveProvider({ provider: 'openai', apiKey: 'o' });
    let started!: () => void;
    const ready = new Promise<void>((resolve) => (started = resolve));
    chat.mockImplementationOnce(
      (_access, _model, request) =>
        new Promise((_resolve, reject) => {
          started();
          request.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const model = { provider: 'openai', model: 'gpt-5-mini' };
    const pending = service.send({ ...question, model });
    await ready;
    await expect(service.send({ ...question, model })).rejects.toMatchObject({ code: 'AI_BUSY' });
    service.cancel();
    await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
  });

  it('validates the conversation shape', async () => {
    await service.saveProvider({ provider: 'openai', apiKey: 'o' });
    const model = { provider: 'openai', model: 'gpt-5-mini' };
    for (const messages of [
      [],
      [{ role: 'model', text: 'hi' }],
      [{ role: 'user', text: 'a'.repeat(32_001) }],
      [
        { role: 'user', text: 'q' },
        { role: 'model', text: 'a' },
      ],
    ])
      await expect(service.send({ messages, model })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
  });
});
