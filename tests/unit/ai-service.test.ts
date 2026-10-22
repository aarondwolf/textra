import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  AIService,
  CHAT_SYSTEM_PROMPT,
  type ChatGenerate,
  type KeyCipher,
  type ModelLister,
  type OllamaLauncher,
} from '../../src/main/services/ai-service';
import { ProviderHTTPError } from '../../src/main/services/ai-providers';
import {
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  type AIModelInfo,
  type AIProviderId,
} from '../../src/shared/ai';

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
  mistral: [{ id: 'mistral-small-latest', label: 'Mistral Small' }],
  codestral: [{ id: 'codestral-latest', label: 'Codestral' }],
  deepseek: [{ id: 'deepseek-chat', label: 'DeepSeek Chat' }],
  openrouter: [{ id: 'openai/gpt-5-mini', label: 'OpenAI: GPT-5 Mini' }],
  'ollama-cloud': [{ id: 'gpt-oss:120b', label: 'gpt-oss:120b' }],
  'ollama-local': [{ id: 'llama3.2:latest', label: 'llama3.2' }],
  custom: [{ id: 'local-model', label: 'Local model' }],
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
    directory = await mkdtemp(join(tmpdir(), 'textra-ai-service-'));
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
    expect(settings.roleDefaults).toEqual({
      chat: null,
      agent: null,
      completion: null,
      inlineCompletion: null,
    });
    expect(settings.completion).toEqual({
      enabled: false,
      allowOutsideEnvironments: false,
      consentedModel: null,
    });
    expect(settings.providers.map(({ id }) => id)).toEqual([
      'google',
      'openai',
      'anthropic',
      'mistral',
      'deepseek',
      'openrouter',
      'ollama-cloud',
      'ollama-local',
      'custom',
    ]);
  });

  it.each(AI_PROVIDER_IDS.filter((provider) => provider !== 'codestral' && provider !== 'custom'))(
    'sends the exact same chat instructions through %s',
    async (provider) => {
      const settings = await service.saveProvider(
        AI_PROVIDERS[provider].needsKey ? { provider, apiKey: 'fixture-key' } : { provider },
      );
      const model = settings.providers.find(({ id }) => id === provider)!.defaultModel!;
      await service.send({ ...question, model: { provider, model } });
      expect(chat.mock.calls.at(-1)?.[2].system).toBe(CHAT_SYSTEM_PROMPT);
      expect(chat.mock.calls.at(-1)?.[0].provider).toBe(provider);
      expect(chat.mock.calls.at(-1)?.[1]).toBe(model);
    },
  );
  it('removes the obsolete Codestral profile during v3 migration without changing Mistral', async () => {
    await service.saveProvider({ provider: 'mistral', apiKey: 'mistral-secret' });
    const file = join(directory, 'ai.json');
    const raw = JSON.parse(await readFile(file, 'utf8'));
    raw.version = 3;
    raw.providers.codestral = {
      ...raw.providers.mistral,
      encryptedKey: cipher.encrypt('obsolete').toString('base64'),
    };
    raw.roleDefaults.chat = { provider: 'codestral', model: 'codestral-latest' };
    await writeFile(file, JSON.stringify(raw));
    const settings = await service.settings();
    expect(settings.roleDefaults.chat).toBeNull();
    expect(settings.roleDefaults.agent).toEqual({
      provider: 'mistral',
      model: 'mistral-small-latest',
    });
    expect(settings.providers.some((provider) => provider.id === 'codestral')).toBe(false);
    expect(JSON.parse(await readFile(file, 'utf8')).providers.codestral).toBeUndefined();
    await service.send({
      ...question,
      model: { provider: 'mistral', model: 'mistral-small-latest' },
    });
    expect(chat.mock.calls.at(-1)?.[0]).toMatchObject({
      provider: 'mistral',
      key: 'mistral-secret',
    });
  });

  it('filters a cached catalogue and preserves blocked defaults without networking or deleting keys', async () => {
    await service.saveProvider({ provider: 'openai', apiKey: 'secret' });
    const filename = join(directory, 'ai.json');
    const raw = JSON.parse(await readFile(filename, 'utf8')) as {
      roleDefaults: { chat: { provider: string; model: string } };
      providers: { openai: { models: AIModelInfo[]; defaultModel: string; encryptedKey: string } };
    };
    raw.providers.openai.models.push({ id: 'gpt-image-1', label: 'Image' });
    raw.providers.openai.defaultModel = 'gpt-image-1';
    raw.roleDefaults.chat = { provider: 'openai', model: 'gpt-image-1' };
    await writeFile(filename, JSON.stringify(raw));
    list.mockClear();
    const settings = await service.settings();
    expect(settings.providers.find(({ id }) => id === 'openai')!.models).toEqual(MODELS.openai);
    expect(settings.roleDefaults.chat).toEqual({ provider: 'openai', model: 'gpt-image-1' });
    expect(list).not.toHaveBeenCalled();
    await expect(
      service.setRoleDefault({ role: 'chat', model: { provider: 'openai', model: 'gpt-image-1' } }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      service.send({ ...question, model: { provider: 'openai', model: 'gpt-image-1' } }),
    ).rejects.toMatchObject({ code: 'AI_MODEL_UNAVAILABLE' });
    expect(chat).not.toHaveBeenCalled();
    expect(await readFile(filename, 'utf8')).toContain(raw.providers.openai.encryptedKey);
  });

  it('tests a key by listing models, encrypts it, and picks sensible defaults', async () => {
    const settings = await service.saveProvider({ provider: 'google', apiKey: '  google-secret ' });
    expect(list).toHaveBeenCalledWith(
      { provider: 'google', key: 'google-secret' },
      expect.any(AbortSignal),
    );
    expect(settings.configured).toBe(true);
    expect(settings.roleDefaults.chat).toEqual({
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
    });
    expect(settings.roleDefaults.agent).toEqual(settings.roleDefaults.chat);
    expect(settings.roleDefaults.inlineCompletion).toEqual(settings.roleDefaults.chat);
    expect(settings.roleDefaults.completion).toBeNull();
    const google = settings.providers.find(({ id }) => id === 'google')!;
    expect(google.models).toEqual(MODELS.google);
    expect(google.defaultModel).toBe('gemini-3.5-flash-lite');
    const raw = await readFile(join(directory, 'ai.json'), 'utf8');
    expect(raw).not.toContain('google-secret');
    expect(JSON.stringify(settings)).not.toContain('google-secret');
  });

  it('keeps independent role defaults when more providers are added', async () => {
    await service.saveProvider({ provider: 'google', apiKey: 'g' });
    let settings = await service.saveProvider({ provider: 'anthropic', apiKey: 'a' });
    expect(settings.roleDefaults.chat?.provider).toBe('google');
    expect(settings.providers.find(({ id }) => id === 'anthropic')!.defaultModel).toBe(
      'claude-haiku-5-5',
    );
    settings = await service.setRoleDefault({
      role: 'chat',
      model: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    });
    expect(settings.roleDefaults.chat).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
    });
    expect(settings.roleDefaults.agent).toEqual({
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
    });
    expect(settings.roleDefaults.inlineCompletion).toEqual(settings.roleDefaults.agent);
    settings = await service.setProviderDefault({ provider: 'google', model: 'gemini-3.8-flash' });
    expect(settings.providers.find(({ id }) => id === 'google')!.defaultModel).toBe(
      'gemini-3.8-flash',
    );
    await expect(
      service.setRoleDefault({ role: 'chat', model: { provider: 'openai', model: 'gpt-5' } }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      service.setProviderDefault({ provider: 'google', model: 'unlisted' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('clears affected role defaults when their provider is removed without rerouting', async () => {
    await service.saveProvider({ provider: 'openai', apiKey: 'o' });
    await service.saveProvider({ provider: 'anthropic', apiKey: 'a' });
    const settings = await service.removeProvider({ provider: 'openai' });
    expect(settings.roleDefaults.chat).toBeNull();
    expect(settings.roleDefaults.agent).toBeNull();
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
    expect(access).toMatchObject({ provider: 'openai', key: 'openai-secret' });
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
    expect(updated).toMatchObject({ error: null, defaultModel: 'gpt-5-mini' });
    expect(refreshed.roleDefaults.chat).toEqual({ provider: 'openai', model: 'gpt-5-mini' });
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
    expect(settings.roleDefaults.chat).toEqual({
      provider: 'ollama-local',
      model: 'llama3.2:latest',
    });
    await plain.send({ ...question, model: settings.roleDefaults.chat });
    expect(chat.mock.calls[0][0]).toMatchObject({ provider: 'ollama-local', key: null });
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
    expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ provider: 'google', key: 'old-key' });
    expect(settings.configured).toBe(true);
  });

  it('preserves an invalid or newer settings file', async () => {
    const file = join(directory, 'ai.json');
    await writeFile(file, JSON.stringify({ version: 5, autoSendProblems: false, providers: {} }));
    await expect(service.settings()).rejects.toMatchObject({ code: 'AI_STORAGE' });
    await expect(service.saveProvider({ provider: 'openai', apiKey: 'o' })).rejects.toMatchObject({
      code: 'AI_STORAGE',
    });
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(5);
  });

  it('atomically migrates v2 defaults, keys and catalogues without networking', async () => {
    await service.saveProvider({ provider: 'google', apiKey: 'google-secret' });
    await service.saveProvider({ provider: 'openai', apiKey: 'openai-secret' });
    const file = join(directory, 'ai.json');
    const current = JSON.parse(await readFile(file, 'utf8')) as { providers: unknown };
    const previous = {
      version: 2,
      autoSendProblems: true,
      defaultModel: { provider: 'openai', model: 'gpt-5' },
      providers: current.providers,
    };
    await writeFile(file, JSON.stringify(previous));
    list.mockClear();
    const settings = await service.settings();
    expect(settings.roleDefaults.chat).toEqual(previous.defaultModel);
    expect(settings.roleDefaults.agent).toEqual(previous.defaultModel);
    expect(settings.roleDefaults.inlineCompletion).toEqual({
      provider: 'google',
      model: 'gemini-3.5-flash-lite',
    });
    expect(settings.roleDefaults.completion).toBeNull();
    expect(settings.autoSendProblems).toBe(true);
    expect(settings.completion.enabled).toBe(false);
    expect(list).not.toHaveBeenCalled();
    const migrated = JSON.parse(await readFile(file, 'utf8')) as {
      version: number;
      providers: unknown;
    };
    expect(migrated.version).toBe(4);
    expect(migrated.providers).toEqual(current.providers);
    await service.send({ ...question, model: settings.roleDefaults.chat });
    expect(chat.mock.calls.at(-1)?.[0]).toMatchObject({ provider: 'openai', key: 'openai-secret' });
  });

  it('preserves concurrent user updates while initial settings reads migrate v2', async () => {
    await service.saveProvider({ provider: 'openai', apiKey: 'retained-secret' });
    const file = join(directory, 'ai.json');
    const existing = JSON.parse(await readFile(file, 'utf8')) as { providers: unknown };
    await writeFile(
      file,
      JSON.stringify({
        version: 2,
        autoSendProblems: false,
        providers: existing.providers,
        defaultModel: { provider: 'openai', model: 'gpt-5-mini' },
      }),
    );
    await Promise.all([
      ...Array.from({ length: 8 }, () => service.settings()),
      service.setAutoSend({ autoSendProblems: true }),
      service.setRoleDefault({ role: 'agent', model: { provider: 'openai', model: 'gpt-5' } }),
    ]);
    const restarted = new AIService(directory, cipher, { list, chat, ollama });
    const settings = await restarted.settings();
    expect(settings.autoSendProblems).toBe(true);
    expect(settings.roleDefaults.chat).toEqual({ provider: 'openai', model: 'gpt-5-mini' });
    expect(settings.roleDefaults.agent).toEqual({ provider: 'openai', model: 'gpt-5' });
    await restarted.send({ ...question, model: settings.roleDefaults.agent });
    expect(chat.mock.calls.at(-1)?.[0]).toMatchObject({
      provider: 'openai',
      key: 'retained-secret',
    });
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(4);
  });

  it('prefills only an installed local Qwen coder and prefers 0.5B for testing', async () => {
    list.mockResolvedValueOnce([
      { id: 'qwen2.5-coder:0.5b', label: '0.5B' },
      { id: 'qwen2.5-coder:7b', label: '7B' },
      { id: 'qwen2.5-coder:1.5b', label: '1.5B' },
      { id: 'qwen2.5-coder:3b', label: '3B' },
      { id: 'llama3.2:latest', label: 'Llama' },
    ]);
    // Preserve a provider default that is not a coder, exercising size preference.
    await service.saveProvider({ provider: 'ollama-local' });
    await service.setProviderDefault({ provider: 'ollama-local', model: 'llama3.2:latest' });
    const file = join(directory, 'ai.json');
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    raw.version = 2;
    raw.defaultModel = { provider: 'ollama-local', model: 'llama3.2:latest' };
    delete raw.roleDefaults;
    delete raw.completion;
    await writeFile(file, JSON.stringify(raw));
    expect((await service.settings()).roleDefaults.completion).toEqual({
      provider: 'ollama-local',
      model: 'qwen2.5-coder:0.5b',
    });
    expect(ollama.start).not.toHaveBeenCalled();
  });

  it('requires main-owned consent and confirms again when the automatic model changes', async () => {
    const confirm = vi.fn(async () => true);
    service = new AIService(directory, cipher, { list, chat, ollama, confirmAutomatic: confirm });
    await service.saveProvider({ provider: 'google', apiKey: 'g' });
    const first = { provider: 'google', model: 'gemini-3.5-flash-lite' };
    const second = { provider: 'google', model: 'gemini-3.8-flash' };
    await service.setRoleDefault({ role: 'completion', model: first });
    expect(confirm).not.toHaveBeenCalled();
    const enabled = await service.setCompletionSettings({
      enabled: true,
      allowOutsideEnvironments: false,
    });
    expect(enabled?.completion).toEqual({
      enabled: true,
      allowOutsideEnvironments: false,
      consentedModel: first,
    });
    expect(confirm).toHaveBeenCalledWith(first, 'https://generativelanguage.googleapis.com');
    const changed = await service.setRoleDefault({ role: 'completion', model: second });
    expect(confirm).toHaveBeenLastCalledWith(second, 'https://generativelanguage.googleapis.com');
    expect(changed.completion.consentedModel).toEqual(second);
    expect(changed.completion.enabled).toBe(true);
    expect(changed.roleDefaults.chat).toEqual(first);
    confirm.mockResolvedValueOnce(false);
    await expect(
      service.setRoleDefault({ role: 'completion', model: first }),
    ).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect((await service.settings()).roleDefaults.completion).toEqual(second);
    await service.removeProvider({ provider: 'google' });
    expect((await service.settings()).completion).toMatchObject({
      enabled: true,
      consentedModel: null,
    });
  });

  it('keeps automatic suggestions disabled when enable consent is declined', async () => {
    service = new AIService(directory, cipher, {
      list,
      chat,
      ollama,
      confirmAutomatic: async () => false,
    });
    await service.saveProvider({ provider: 'google', apiKey: 'g' });
    await service.setRoleDefault({
      role: 'completion',
      model: { provider: 'google', model: 'gemini-3.5-flash-lite' },
    });
    expect(
      await service.setCompletionSettings({ enabled: true, allowOutsideEnvironments: true }),
    ).toBeNull();
    expect((await service.settings()).completion.enabled).toBe(false);
  });

  it('allows FIM-only models for completion but excludes them from Chat and Agent defaults', async () => {
    list.mockResolvedValueOnce([
      {
        id: 'codestral-latest',
        label: 'Codestral',
        capabilities: { chat: false, completion: true, transport: 'mistral-fim' },
      },
    ]);
    const saved = await service.saveProvider({ provider: 'mistral', apiKey: 'c' });
    expect(saved.roleDefaults.chat).toBeNull();
    expect(saved.roleDefaults.agent).toBeNull();
    await service.setRoleDefault({
      role: 'completion',
      model: { provider: 'mistral', model: 'codestral-latest' },
    });
    await expect(
      service.setRoleDefault({
        role: 'chat',
        model: { provider: 'mistral', model: 'codestral-latest' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
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
