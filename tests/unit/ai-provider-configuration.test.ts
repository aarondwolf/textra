import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIService, type KeyCipher, type ModelLister } from '../../src/main/services/ai-service';
import type { streamChat } from '../../src/main/services/ai-providers';
import type { AIMessage } from '../../src/shared/api';
import { validateAIEndpoint } from '../../src/main/services/ai-endpoints';
import type { AIProviderConfiguration, AICompletionRequest } from '../../src/shared/ai';

// Provider SDK packages load lazily, only for a connection that receives a real request.
const sdkLoaded = vi.hoisted(() => vi.fn());
vi.mock('@ai-sdk/google', () => {
  sdkLoaded();
  return { createGoogleGenerativeAI: () => () => ({}) };
});
const config: AIProviderConfiguration = {
  provider: 'custom',
  enabled: true,
  endpoint: 'http://127.0.0.1:8000/v1',
  displayName: 'My server',
  defaultModel: 'tiny-model',
  filters: { chat: { mode: 'all', models: [] }, completion: { mode: 'all', models: [] } },
  supportsTools: false,
  manualModels: ['tiny-model'],
};
const model = { provider: 'custom' as const, model: 'tiny-model' };
const question = { model, messages: [{ role: 'user', text: 'fixture question' }] };
const snapshot: AICompletionRequest = {
  requestId: 'auto-test',
  role: 'completion',
  model,
  projectId: 'fixture',
  path: 'main.tex',
  revision: 'revision',
  modelVersion: 1,
  offset: 6,
  prefix: 'before',
  suffix: 'after',
  metadata: '',
};

describe('provider base URL validation', () => {
  it.each([
    'https://example.com/v1/',
    'http://localhost:8000/v1',
    'http://127.0.0.1:11434',
    'http://10.0.0.2:8080',
    'http://172.16.0.1',
    'http://192.168.1.3',
    'http://[::1]:8080',
    'http://[fd00::1]:8080',
    'http://[::ffff:127.0.0.1]:8080',
  ])('accepts configured HTTPS or private/loopback HTTP: %s', (endpoint) =>
    expect(validateAIEndpoint(endpoint)).not.toMatch(/\/$/),
  );
  it.each([
    'http://example.com/v1',
    'http://8.8.8.8',
    'http://[2001:4860::1]',
    'ftp://localhost',
    'https://user:secret@example.com',
    'https://example.com?token=x',
    'https://example.com/#fragment',
    'https://example.com/?',
    'https://example.com/#',
    'https://exa\nmple.com',
    '',
  ])('rejects unsafe or credential-bearing endpoints: %s', (endpoint) =>
    expect(() => validateAIEndpoint(endpoint)).toThrow(),
  );
});

describe('offline provider configuration and role policy', () => {
  let directory: string;
  let service: AIService;
  let cipher: KeyCipher;
  let chat: ReturnType<typeof vi.fn<typeof streamChat>>;
  // Foreground requests run through withProvider; the fixture generator stands in for the SDK.
  const send = (value: { model: unknown; messages: unknown }) =>
    service.withProvider(
      value.model,
      (access, id, signal) =>
        chat(access, id, {
          system: 'fixture',
          messages: value.messages as AIMessage[],
          maxTokens: 4096,
          signal,
        }),
      'assistant',
    );
  let list: ReturnType<typeof vi.fn<ModelLister>>;
  let confirm: ReturnType<typeof vi.fn<(model: unknown, endpoint?: string) => Promise<boolean>>>;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'textra-provider-config-'));
    cipher = {
      available: () => true,
      encrypt: (value) => Buffer.from(value),
      decrypt: vi.fn((value) => value.toString()),
    };
    chat = vi.fn<typeof streamChat>(async () => 'fixture response');
    list = vi.fn<ModelLister>(async () => [{ id: 'tiny-model', label: 'Tiny' }]);
    confirm = vi.fn(async () => true);
    service = new AIService(directory, cipher, { list, confirmAutomatic: confirm });
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  it('saves and reads independently without listing models, decrypting keys or loading the Google SDK', async () => {
    await service.configureProvider({
      ...config,
      provider: 'google',
      endpoint: 'https://generativelanguage.googleapis.com',
      apiKey: 'saved-key',
      manualModels: ['gemini-fixture'],
      defaultModel: 'gemini-fixture',
    });
    const encrypted = JSON.parse(await readFile(join(directory, 'ai.json'), 'utf8')).providers
      .google.encryptedKey;
    const decrypt = vi.fn(() => {
      throw new Error('Other OS account');
    });
    service = new AIService(directory, { ...cipher, available: () => false, decrypt }, { list });
    const settings = await service.configureProvider({
      ...config,
      provider: 'google',
      enabled: false,
      endpoint: 'https://proxy.example/v1',
      manualModels: ['gemini-fixture'],
      defaultModel: 'gemini-fixture',
    });
    expect(settings.providers.find((provider) => provider.id === 'google')).toMatchObject({
      enabled: false,
      configured: true,
      endpoint: 'https://proxy.example/v1',
    });
    expect(
      JSON.parse(await readFile(join(directory, 'ai.json'), 'utf8')).providers.google.encryptedKey,
    ).toBe(encrypted);
    expect(decrypt).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(sdkLoaded).not.toHaveBeenCalled();
  });
  it('routes a custom optional-key model only after an explicit request', async () => {
    await service.configureProvider(config);
    await service.setRoleDefault({ role: 'assistant', model });
    await send(question);
    expect(chat.mock.calls[0][0]).toMatchObject({
      provider: 'custom',
      key: null,
      endpoint: config.endpoint,
      supportsTools: false,
    });
    expect(list).not.toHaveBeenCalled();
  });
  it('preserves a disabled default while blocking requests and restores it on enable', async () => {
    await service.configureProvider(config);
    await service.setRoleDefault({ role: 'assistant', model });
    await service.configureProvider({ ...config, enabled: false });
    expect((await service.settings()).roleDefaults.assistant).toEqual(model);
    await expect(send(question)).rejects.toMatchObject({ code: 'AI_PROVIDER_DISABLED' });
    expect(chat).not.toHaveBeenCalled();
    await service.configureProvider(config);
    expect(await send(question)).toBe('fixture response');
  });
  it('keeps full catalogues and defaults while applying separate chat and completion visibility', async () => {
    await service.configureProvider(config);
    await service.setRoleDefault({ role: 'assistant', model });
    const filtered = {
      ...config,
      filters: {
        chat: { mode: 'exclude' as const, models: ['tiny-model'] },
        completion: { mode: 'include' as const, models: ['tiny-model'] },
      },
    };
    const settings = await service.configureProvider(filtered);
    expect(settings.roleDefaults.assistant).toEqual(model);
    expect(settings.providers.find((provider) => provider.id === 'custom')?.models).toHaveLength(1);
    await expect(send(question)).rejects.toMatchObject({ code: 'AI_MODEL_UNAVAILABLE' });
    await service.setRoleDefault({ role: 'completion', model });
    await expect(service.setRoleDefault({ role: 'inlineCompletion', model })).rejects.toMatchObject(
      { code: 'INVALID_ARGUMENT' },
    );
  });
  it('keeps a connection without tool support usable by the Assistant and inline editing', async () => {
    await service.configureProvider(config);
    expect(await service.withProvider(model, async (access) => access.supportsTools)).toBe(false);
    expect(await service.withProvider(model, async () => 'inline', 'inlineCompletion')).toBe(
      'inline',
    );
    await service.configureProvider({ ...config, supportsTools: true });
    expect(await service.withProvider(model, async (access) => access.supportsTools)).toBe(true);
  });
  it('saves automatic enable before a model exists and confirms selection later', async () => {
    const enabled = await service.setCompletionSettings({
      enabled: true,
      allowOutsideEnvironments: false,
    });
    expect(enabled?.completion).toMatchObject({ enabled: true, consentedModel: null });
    expect(confirm).not.toHaveBeenCalled();
    await service.configureProvider(config);
    await service.setRoleDefault({ role: 'completion', model });
    expect(confirm).toHaveBeenCalledWith(model, config.endpoint);
  });
  it('revokes consent on endpoint change and requires explicit same-model confirmation', async () => {
    await service.configureProvider(config);
    await service.setRoleDefault({ role: 'completion', model });
    await service.setCompletionSettings({ enabled: true, allowOutsideEnvironments: false });
    const updated = { ...config, endpoint: 'https://another.example/v1' };
    await service.configureProvider(updated);
    expect((await service.settings()).completion).toMatchObject({
      enabled: true,
      consentedModel: null,
    });
    await expect(service.complete(snapshot)).rejects.toMatchObject({ code: 'AI_CONSENT_REQUIRED' });
    await service.setRoleDefault({ role: 'completion', model });
    expect(confirm).toHaveBeenLastCalledWith(model, updated.endpoint);
  });
  it('refreshes only explicitly and preserves settings/defaults when the provider is unavailable', async () => {
    await service.configureProvider(config);
    list.mockRejectedValueOnce(new Error('offline'));
    await expect(service.refreshModels({ provider: 'custom' })).rejects.toMatchObject({
      code: 'AI_NETWORK',
    });
    expect(list).toHaveBeenCalledOnce();
    const settings = await service.settings();
    expect(settings.providers.find((provider) => provider.id === 'custom')).toMatchObject({
      enabled: true,
      endpoint: config.endpoint,
      defaultModel: config.defaultModel,
      manualModels: ['tiny-model'],
    });
  });
  it('returns automatic empty output quietly while preserving manual errors and safe diagnostics', async () => {
    const diagnostic = vi.fn();
    const completion = vi.fn(async () => '');
    service = new AIService(directory, cipher, {
      list,
      completion,
      confirmAutomatic: confirm,
      onCompletionDiagnostic: diagnostic,
    });
    await service.configureProvider(config);
    await service.setRoleDefault({ role: 'completion', model });
    await service.setCompletionSettings({ enabled: true, allowOutsideEnvironments: false });
    expect(await service.complete(snapshot)).toEqual({
      requestId: snapshot.requestId,
      modelVersion: 1,
      offset: 6,
      text: '',
    });
    expect(diagnostic.mock.calls[0][0]).toMatchObject({
      normalization: 'empty',
      responseCharacters: 0,
    });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(snapshot.prefix);
    await expect(
      service.complete({ ...snapshot, role: 'inlineCompletion', requestId: 'manual-empty' }),
    ).rejects.toMatchObject({ code: 'AI_EMPTY' });
  });
  it('migrates v3 atomically without decrypting keys, networking or changing saved bindings', async () => {
    await service.configureProvider({
      ...config,
      provider: 'google',
      endpoint: 'https://generativelanguage.googleapis.com',
      apiKey: 'retained-key',
      manualModels: ['gemini-fixture'],
      defaultModel: 'gemini-fixture',
    });
    const filename = join(directory, 'ai.json');
    const raw = JSON.parse(await readFile(filename, 'utf8'));
    raw.version = 3;
    raw.roleDefaults = {
      chat: { provider: 'google', model: 'gemini-fixture' },
      agent: null,
      completion: null,
      inlineCompletion: null,
    };
    const key = raw.providers.google.encryptedKey;
    delete raw.providers.google.endpoint;
    delete raw.providers.google.filters;
    await writeFile(filename, JSON.stringify(raw));
    const decrypt = vi.fn(() => {
      throw new Error('Key unavailable');
    });
    service = new AIService(directory, { ...cipher, decrypt }, { list });
    const results = await Promise.all(Array.from({ length: 5 }, () => service.settings()));
    expect(results[0].roleDefaults.assistant).toEqual(raw.roleDefaults.chat);
    expect(JSON.parse(await readFile(filename, 'utf8'))).toMatchObject({
      version: 5,
      providers: { google: { encryptedKey: key } },
    });
    expect(decrypt).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(sdkLoaded).not.toHaveBeenCalled();
  });
  it('does not emit failure diagnostics for expected completion cancellation', async () => {
    const diagnostic = vi.fn();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    service = new AIService(directory, cipher, {
      list,
      confirmAutomatic: confirm,
      onCompletionDiagnostic: diagnostic,
      completion: async () => {
        started();
        return new Promise<string>(() => undefined);
      },
    });
    await service.configureProvider(config);
    await service.setRoleDefault({ role: 'completion', model });
    await service.setCompletionSettings({ enabled: true, allowOutsideEnvironments: false });
    const pending = service.complete(snapshot);
    await ready;
    service.cancelCompletion({ requestId: snapshot.requestId });
    await expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
    expect(diagnostic).not.toHaveBeenCalled();
  });
  it('invalidates only the discovered catalogue when its endpoint changes', async () => {
    await service.configureProvider({ ...config, manualModels: [] });
    await service.refreshModels({ provider: 'custom' });
    await service.setRoleDefault({ role: 'assistant', model });
    const settings = await service.configureProvider({
      ...config,
      endpoint: 'https://new.example/v1',
      manualModels: [],
    });
    expect(settings.providers.find((provider) => provider.id === 'custom')).toMatchObject({
      models: [],
      modelsFetchedAt: null,
      defaultModel: 'tiny-model',
    });
    expect(settings.roleDefaults.assistant).toEqual(model);
    await expect(send(question)).rejects.toMatchObject({ code: 'AI_MODEL_UNAVAILABLE' });
  });
  it.each(['disable', 'endpoint', 'visibility', 'key', 'tools'] as const)(
    'cancels active foreground work after matching provider %s changes',
    async (change) => {
      await service.configureProvider({ ...config, supportsTools: true });
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      chat.mockImplementationOnce(async () => {
        started();
        return new Promise<string>(() => undefined);
      });
      const pending =
        change === 'tools'
          ? service.withProvider(model, async () => {
              started();
              return new Promise<string>(() => undefined);
            })
          : send(question);
      const stopped = expect(pending).rejects.toMatchObject({ code: 'AI_CANCELLED' });
      await ready;
      await service.configureProvider({
        ...config,
        supportsTools: true,
        ...(change === 'disable' ? { enabled: false } : {}),
        ...(change === 'endpoint' ? { endpoint: 'https://changed.example/v1' } : {}),
        ...(change === 'visibility'
          ? {
              filters: {
                ...config.filters,
                chat: { mode: 'exclude' as const, models: ['tiny-model'] },
              },
            }
          : {}),
        ...(change === 'key' ? { apiKey: 'new-key' } : {}),
        ...(change === 'tools' ? { supportsTools: false } : {}),
      });
      await stopped;
    },
  );
  it('does not cancel foreground work when a different provider is configured', async () => {
    await service.configureProvider(config);
    let started!: () => void;
    let finish!: (text: string) => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    chat.mockImplementationOnce(async () => {
      started();
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    });
    const pending = send(question);
    await ready;
    await service.configureProvider({
      ...config,
      provider: 'google',
      endpoint: 'https://generativelanguage.googleapis.com',
      manualModels: [],
      defaultModel: null,
    });
    expect(chat.mock.calls[0][2].signal.aborted).toBe(false);
    finish('finished');
    expect(await pending).toBe('finished');
  });
  it('does not cancel automatic completion when a different provider is configured', async () => {
    let started!: () => void;
    let finish!: (text: string) => void;
    let signal!: AbortSignal;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    service = new AIService(directory, cipher, {
      list,
      confirmAutomatic: confirm,
      completion: async (_access, _model, request) => {
        signal = request.signal;
        started();
        return new Promise<string>((resolve) => {
          finish = resolve;
        });
      },
    });
    await service.configureProvider(config);
    await service.setRoleDefault({ role: 'completion', model });
    await service.setCompletionSettings({ enabled: true, allowOutsideEnvironments: false });
    const pending = service.complete(snapshot);
    await ready;
    await service.configureProvider({
      ...config,
      provider: 'google',
      endpoint: 'https://generativelanguage.googleapis.com',
      manualModels: [],
      defaultModel: null,
    });
    expect(signal.aborted).toBe(false);
    finish('insert');
    expect((await pending).text).toBe('insert');
  });
  it('keeps the configured endpoint when the legacy key-save operation refreshes a provider', async () => {
    await service.configureProvider({ ...config, provider: 'mistral', apiKey: 'first-key' });
    await service.saveProvider({ provider: 'mistral', apiKey: 'replacement-key' });
    expect(list.mock.calls[0][0]).toMatchObject({
      provider: 'mistral',
      endpoint: config.endpoint,
      key: 'replacement-key',
    });
  });
});
