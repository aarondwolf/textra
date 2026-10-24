import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import type { AIProviderSettings, AISettings, OllamaLocalStatus } from '../../shared/api';
import {
  AI_ROLES,
  completionTimeout,
  sameModel,
  supportsAIRole,
  type AIRole,
  type AIRoleDefaults,
  type AIAutomaticSettings,
  type AICompletionRequest,
  type AICompletionResponse,
  AI_MODEL_ID_PATTERN,
  AI_PROVIDER_IDS,
  AI_PROVIDERS,
  AI_DEFAULT_ENDPOINTS,
  isModelVisible,
  isAIProviderId,
  type AIModelInfo,
  type AIModelRef,
  type AIProviderId,
  type AIModelVisibility,
  type AIProviderConfiguration,
} from '../../shared/ai';
import {
  listModels,
  ollamaVersion,
  ProviderHTTPError,
  completionGenerate,
  type ProviderAccess,
} from './ai-providers';
import { cleanModelList } from './ai-models';
import { validateAIEndpoint } from './ai-endpoints';
import { prepareSDKProvider } from './ai-sdk-runtime';

export class AIError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface KeyCipher {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}
interface StoredProvider {
  encryptedKey: string;
  enabled: boolean;
  defaultModel: string | null;
  models: AIModelInfo[];
  modelsFetchedAt: number | null;
  error: string | null;
  endpoint: string;
  displayName: string;
  filters: { chat: AIModelVisibility; completion: AIModelVisibility };
  supportsTools: boolean;
  manualModels: string[];
}
interface StoredSettings {
  version: 5;
  autoSendProblems: boolean;
  roleDefaults: AIRoleDefaults;
  completion: AIAutomaticSettings;
  legacyGoogleDefaultPending?: boolean;
  providers: Partial<Record<AIProviderId, StoredProvider>>;
}
export type ModelLister = typeof listModels;
export interface OllamaLauncher {
  find(): Promise<string | null>;
  start(executable: string): void;
  version(signal: AbortSignal): Promise<string | null>;
}
export interface AIServiceOptions {
  list?: ModelLister;
  ollama?: OllamaLauncher;
  completion?: typeof completionGenerate;
  confirmAutomatic?: (model: AIModelRef, endpoint?: string) => Promise<boolean>;
  onCompletionDiagnostic?: (diagnostic: {
    provider: AIProviderId;
    model: string;
    transport: string;
    milliseconds: number;
    httpStatus?: number;
    finishReason?: string;
    responseCharacters?: number;
    normalization: 'empty' | 'accepted' | 'failed';
  }) => void;
}

const SETTINGS_LIMIT = 1_048_576;
const EMPTY: StoredSettings = {
  version: 5,
  autoSendProblems: false,
  roleDefaults: { assistant: null, completion: null, inlineCompletion: null },
  completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
  providers: {},
};
const PREFERRED: Record<AIProviderId, RegExp[]> = {
  google: [/^gemini-[\d.]+-flash-lite$/, /^gemini-[\d.]+-flash$/, /gemini/],
  openai: [/^gpt-[\d.]+-mini$/, /^gpt-[\d.]+$/, /^gpt-/],
  anthropic: [/haiku/, /sonnet/],
  mistral: [/^mistral-small-latest$/, /^mistral-medium-latest$/, /mistral/],
  codestral: [/^codestral-latest$/, /^codestral-/],
  deepseek: [/^deepseek-chat$/, /flash/, /deepseek/],
  openrouter: [/^google\/gemini-[\d.]+-flash-lite$/, /^openai\/gpt-[\d.]+-mini$/],
  'ollama-cloud': [],
  'ollama-local': [],
  custom: [],
};

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function storageError(): never {
  throw new AIError(
    'AI_STORAGE',
    'AI settings are invalid or from a newer version. The file was preserved.',
  );
}
function parseModels(value: unknown): AIModelInfo[] {
  if (!Array.isArray(value) || value.length > 500) storageError();
  return value.map((item: unknown) => {
    if (
      !record(item) ||
      typeof item.id !== 'string' ||
      typeof item.label !== 'string' ||
      item.id.length > 200 ||
      item.label.length > 200
    )
      storageError();
    const caps = item.capabilities;
    if (
      caps !== undefined &&
      (!record(caps) ||
        typeof caps.chat !== 'boolean' ||
        typeof caps.completion !== 'boolean' ||
        !['chat', 'mistral-fim', 'ollama-generate'].includes(String(caps.transport)))
    )
      storageError();
    return {
      id: item.id,
      label: item.label,
      ...(caps
        ? { capabilities: caps as unknown as NonNullable<AIModelInfo['capabilities']> }
        : {}),
    };
  });
}
function parseRef(value: unknown): AIModelRef | null {
  if (value === null) return null;
  if (!record(value) || !isAIProviderId(value.provider) || typeof value.model !== 'string')
    storageError();
  return { provider: value.provider, model: value.model };
}
function visibility(value: unknown): AIModelVisibility {
  if (
    !record(value) ||
    !['all', 'include', 'exclude'].includes(String(value.mode)) ||
    !Array.isArray(value.models) ||
    value.models.length > 500 ||
    value.models.some((id) => typeof id !== 'string' || !AI_MODEL_ID_PATTERN.test(id))
  )
    throw new AIError('INVALID_ARGUMENT', 'Choose valid model visibility rules.');
  return {
    mode: value.mode as AIModelVisibility['mode'],
    models: [...new Set(value.models as string[])],
  };
}
function parseProvider(id: AIProviderId, value: unknown): StoredProvider {
  if (
    !record(value) ||
    typeof value.encryptedKey !== 'string' ||
    !/^[A-Za-z0-9+/=]*$/.test(value.encryptedKey) ||
    typeof value.enabled !== 'boolean' ||
    !(value.defaultModel === null || typeof value.defaultModel === 'string') ||
    !(value.modelsFetchedAt === null || typeof value.modelsFetchedAt === 'number') ||
    !(value.error === null || typeof value.error === 'string')
  )
    storageError();
  if (
    (value.endpoint !== undefined && typeof value.endpoint !== 'string') ||
    (value.displayName !== undefined &&
      (typeof value.displayName !== 'string' || value.displayName.length > 80)) ||
    (value.supportsTools !== undefined && typeof value.supportsTools !== 'boolean') ||
    (value.manualModels !== undefined &&
      (!Array.isArray(value.manualModels) ||
        value.manualModels.length > 500 ||
        value.manualModels.some(
          (model) => typeof model !== 'string' || !AI_MODEL_ID_PATTERN.test(model),
        )))
  )
    storageError();
  let endpoint = typeof value.endpoint === 'string' ? value.endpoint : AI_DEFAULT_ENDPOINTS[id];
  try {
    if (endpoint || id !== 'custom') endpoint = validateAIEndpoint(endpoint);
  } catch {
    storageError();
  }
  let filters: StoredProvider['filters'] = {
    chat: { mode: 'all', models: [] },
    completion: { mode: 'all', models: [] },
  };
  if (value.filters !== undefined) {
    try {
      if (!record(value.filters)) storageError();
      filters = {
        chat: visibility(value.filters.chat),
        completion: visibility(value.filters.completion),
      };
    } catch {
      storageError();
    }
  }
  return {
    encryptedKey: value.encryptedKey,
    enabled: value.enabled,
    defaultModel: value.defaultModel,
    models: parseModels(value.models),
    modelsFetchedAt: value.modelsFetchedAt,
    error: value.error,
    endpoint,
    displayName: typeof value.displayName === 'string' ? value.displayName : AI_PROVIDERS[id].label,
    filters,
    supportsTools: typeof value.supportsTools === 'boolean' ? value.supportsTools : id !== 'custom',
    manualModels:
      Array.isArray(value.manualModels) &&
      value.manualModels.length <= 500 &&
      value.manualModels.every(
        (model) => typeof model === 'string' && AI_MODEL_ID_PATTERN.test(model),
      )
        ? (value.manualModels as string[])
        : [],
  };
}
function emptyProvider(id: AIProviderId = 'google'): StoredProvider {
  return {
    encryptedKey: '',
    enabled: false,
    defaultModel: null,
    models: [],
    modelsFetchedAt: null,
    error: null,
    endpoint: AI_DEFAULT_ENDPOINTS[id],
    displayName: AI_PROVIDERS[id].label,
    filters: { chat: { mode: 'all', models: [] }, completion: { mode: 'all', models: [] } },
    supportsTools: id !== 'custom',
    manualModels: [],
  };
}
function isConfigured(id: AIProviderId, provider: StoredProvider | undefined): boolean {
  if (!provider) return false;
  return AI_PROVIDERS[id].needsKey ? Boolean(provider.encryptedKey) : Boolean(provider.endpoint);
}
function catalogue(id: AIProviderId, provider: StoredProvider): AIModelInfo[] {
  const models = cleanModelList(id, provider.models);
  const seen = new Set(models.map((model) => model.id));
  return [
    ...models,
    ...provider.manualModels
      .filter((model) => !seen.has(model))
      .map((model) => ({ id: model, label: model })),
  ];
}
function roleAvailable(
  provider: StoredProvider | undefined,
  model: AIModelInfo,
  role: AIRole,
): boolean {
  return (
    !!provider?.enabled &&
    supportsAIRole(model, role) &&
    isModelVisible(
      role === 'completion' ? provider.filters.completion : provider.filters.chat,
      model.id,
    )
  );
}
function pickDefault(id: AIProviderId, models: AIModelInfo[], current: string | null) {
  if (current && models.some((model) => model.id === current)) return current;
  for (const pattern of PREFERRED[id]) {
    const match = models.find((model) => pattern.test(model.id));
    if (match) return match.id;
  }
  return models[0]?.id ?? null;
}
/** Removes the key text from provider messages and keeps them short. */
function sanitize(detail: string, key: string | null): string {
  let text = detail.replace(/\s+/g, ' ').trim();
  if (key) text = text.split(key).join('[key]');
  text = text.replace(/(sk|AIza)[-_A-Za-z0-9]{12,}/g, '[key]');
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}

const ollamaLauncher: OllamaLauncher = {
  async find() {
    const name = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
    const candidates: string[] = [];
    for (const directory of (process.env.PATH ?? '').split(delimiter)) {
      const clean = directory.replace(/^"|"$/g, '');
      if (isAbsolute(clean)) candidates.push(join(clean, name));
    }
    if (process.platform === 'win32' && process.env.LOCALAPPDATA)
      candidates.push(join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', name));
    if (process.platform === 'darwin')
      candidates.push(
        '/Applications/Ollama.app/Contents/Resources/ollama',
        '/opt/homebrew/bin/ollama',
        '/usr/local/bin/ollama',
      );
    if (process.platform === 'linux') candidates.push('/usr/local/bin/ollama', '/usr/bin/ollama');
    for (const file of candidates) {
      try {
        await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        if ((await stat(file)).isFile()) return await realpath(file);
      } catch {
        /* Try the next candidate. */
      }
    }
    return null;
  },
  start(executable) {
    // Fixed executable and arguments; the server outlives TeXtra like the Ollama app does.
    const child = spawn(executable, ['serve'], {
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', () => undefined);
    child.unref();
  },
  version: ollamaVersion,
};

/** Owns provider credentials, model lists and the single in-flight AI request. */
export class AIService {
  private active: AbortController | null = null;
  private completionActive: {
    requestId: string;
    role: 'completion' | 'inlineCompletion';
    provider: AIProviderId;
    controller: AbortController;
  } | null = null;
  private readonly cancelledCompletions = new Map<string, number>();
  private reserved = false;
  private activeContext: { model: AIModelRef; role: AIRole } | null = null;
  private cancellationVersion = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private migration: Promise<void> | null = null;
  private readonly list: ModelLister;
  private readonly ollama: OllamaLauncher;
  constructor(
    private readonly directory: string,
    private readonly cipher: KeyCipher,
    private readonly options: AIServiceOptions = {},
  ) {
    this.list = options.list ?? listModels;
    this.ollama = options.ollama ?? ollamaLauncher;
  }

  // ----- Storage -----

  private async checkPaths(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const dir = await lstat(this.directory);
    if (!dir.isDirectory() || dir.isSymbolicLink())
      throw new AIError('AI_STORAGE', 'AI settings directory must not be a symlink.');
    try {
      const file = await lstat(join(this.directory, 'ai.json'));
      if (!file.isFile() || file.isSymbolicLink() || file.size > SETTINGS_LIMIT)
        throw new AIError('AI_STORAGE', 'AI settings file is unsafe or too large.');
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        throw error;
    }
  }
  private async read(): Promise<StoredSettings> {
    await this.checkPaths();
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(this.directory, 'ai.json'), 'utf8'));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return structuredClone(EMPTY);
      throw new AIError(
        'AI_STORAGE',
        'AI settings could not be read. The existing file was preserved.',
      );
    }
    if (!record(raw) || typeof raw.autoSendProblems !== 'boolean') storageError();
    if (raw.version === 1) {
      // Single-key Gemini settings become the Google provider.
      if (typeof raw.encryptedKey !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(raw.encryptedKey))
        storageError();
      return {
        ...structuredClone(EMPTY),
        autoSendProblems: raw.autoSendProblems,
        legacyGoogleDefaultPending: Boolean(raw.encryptedKey),
        providers: raw.encryptedKey
          ? {
              google: { ...emptyProvider('google'), enabled: true, encryptedKey: raw.encryptedKey },
            }
          : {},
      };
    }
    if (![2, 3, 4, 5].includes(Number(raw.version)) || !record(raw.providers)) storageError();
    const providers: StoredSettings['providers'] = {};
    for (const [id, value] of Object.entries(raw.providers)) {
      if (!isAIProviderId(id)) storageError();
      if (id !== 'codestral') providers[id] = parseProvider(id, value);
    }
    const settings: StoredSettings = {
      ...structuredClone(EMPTY),
      autoSendProblems: raw.autoSendProblems,
      providers,
    };
    if (raw.version === 2) {
      settings.roleDefaults.assistant = parseRef(raw.defaultModel);
      this.prefillCompletion(settings);
    } else {
      if (
        !record(raw.roleDefaults) ||
        !record(raw.completion) ||
        typeof raw.completion.enabled !== 'boolean' ||
        typeof raw.completion.allowOutsideEnvironments !== 'boolean'
      )
        storageError();
      if (raw.version === 5)
        for (const role of AI_ROLES) settings.roleDefaults[role] = parseRef(raw.roleDefaults[role]);
      else {
        // v3/v4 → v5: Chat and Agent become one Assistant role. Prefer the saved Chat model,
        // then the saved Agent model. Unavailable selections are preserved (shown as
        // unavailable), never silently substituted. Chat and Agent shared each provider's
        // chat visibility rule, so the unified role keeps that same (intersected) rule.
        // The obsolete Codestral profile is skipped here; it is removed below in any case.
        const legacy = (value: unknown) => {
          const ref = parseRef(value);
          return ref?.provider === 'codestral' ? null : ref;
        };
        settings.roleDefaults.assistant =
          legacy(raw.roleDefaults.chat) ?? legacy(raw.roleDefaults.agent);
        settings.roleDefaults.completion = parseRef(raw.roleDefaults.completion);
        settings.roleDefaults.inlineCompletion = parseRef(raw.roleDefaults.inlineCompletion);
      }
      settings.completion = {
        enabled: raw.completion.enabled,
        allowOutsideEnvironments: raw.completion.allowOutsideEnvironments,
        consentedModel: parseRef(raw.completion.consentedModel),
      };
      if (raw.legacyGoogleDefaultPending === true) settings.legacyGoogleDefaultPending = true;
    }
    for (const role of AI_ROLES)
      if (settings.roleDefaults[role]?.provider === 'codestral') settings.roleDefaults[role] = null;
    if (settings.completion.consentedModel?.provider === 'codestral') {
      settings.completion.consentedModel = null;
      settings.completion.enabled = false;
    }
    if (raw.version !== 5) {
      this.normalize(settings);
      // One offline atomic migration shared by concurrent readers. No keys are decrypted.
      this.migration ??= this.write(settings);
      await this.migration;
      return this.read();
    }
    return settings;
  }
  private prefillCompletion(settings: StoredSettings, added?: AIProviderId): void {
    const google = settings.providers.google;
    if (
      (!added || added === 'google') &&
      !settings.roleDefaults.inlineCompletion &&
      isConfigured('google', google) &&
      google?.defaultModel &&
      google.models.some(
        (m) => m.id === google.defaultModel && supportsAIRole(m, 'inlineCompletion'),
      )
    )
      settings.roleDefaults.inlineCompletion = { provider: 'google', model: google.defaultModel };
    const local = settings.providers['ollama-local'];
    if (
      (added && added !== 'ollama-local') ||
      settings.roleDefaults.completion ||
      !isConfigured('ollama-local', local) ||
      !local
    )
      return;
    const eligible = local.models.filter(
      (m) => /qwen.*coder/i.test(m.id) && !/cloud/i.test(m.id) && supportsAIRole(m, 'completion'),
    );
    const chosen =
      eligible.find((m) => /^qwen2\.5-coder:0\.5b(?:-|$)/i.test(m.id)) ??
      eligible.find((m) => m.id === local.defaultModel) ??
      ['3b', '1.5b', '7b']
        .map((size) =>
          eligible.find(
            (m) =>
              m.id.startsWith('qwen2.5-coder:' + size) &&
              /^(?:-|$)/.test(m.id.slice(('qwen2.5-coder:' + size).length)),
          ),
        )
        .find(Boolean);
    if (chosen) settings.roleDefaults.completion = { provider: 'ollama-local', model: chosen.id };
  }

  private static async retryTransient<T>(action: () => Promise<T>): Promise<T> {
    const delays = [50, 100, 200, 400, 800];
    for (let attempt = 0; ; attempt++) {
      try {
        return await action();
      } catch (error) {
        if (
          attempt >= delays.length ||
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          !['EPERM', 'EBUSY', 'EACCES'].includes(String(error.code))
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      }
    }
  }

  private async write(settings: StoredSettings): Promise<void> {
    await this.checkPaths();
    const serialized = JSON.stringify(settings);
    if (Buffer.byteLength(serialized, 'utf8') > SETTINGS_LIMIT)
      throw new AIError(
        'AI_STORAGE',
        'AI settings exceed the storage limit. Reduce the saved model lists.',
      );
    const temporary = join(this.directory, `.ai-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(serialized, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await this.checkPaths();
      await AIService.retryTransient(() => rename(temporary, join(this.directory, 'ai.json')));
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  /** Serializes read-modify-write cycles so concurrent model refreshes cannot drop data. */
  private update(
    change: (settings: StoredSettings) => void,
    affectedProvider?: AIProviderId,
  ): Promise<AISettings> {
    const run = this.queue.then(async () => {
      const settings = await this.read();
      this.normalize(settings);
      change(settings);
      this.normalize(settings);
      await this.write(settings);
      if (!affectedProvider || this.completionActive?.provider === affectedProvider) {
        this.completionActive?.controller.abort();
        this.completionActive = null;
      }
      return this.view(settings);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  /** Clears unavailable role bindings without selecting another destination. */
  private normalize(settings: StoredSettings): void {
    for (const id of AI_PROVIDER_IDS) {
      const stored = settings.providers[id];
      if (!stored) continue;
      stored.models = cleanModelList(id, stored.models);
    }
    for (const role of AI_ROLES) {
      const current = settings.roleDefaults[role];
      const provider = current ? settings.providers[current.provider] : undefined;
      if (current && !provider) settings.roleDefaults[role] = null;
    }
    if (!sameModel(settings.roleDefaults.completion, settings.completion.consentedModel)) {
      settings.completion.consentedModel = null;
    }
  }

  private view(settings: StoredSettings): AISettings {
    const providers: AIProviderSettings[] = AI_PROVIDER_IDS.filter((id) => id !== 'codestral').map(
      (id) => {
        const stored = settings.providers[id];
        return {
          id,
          enabled: stored?.enabled ?? false,
          endpoint: stored?.endpoint ?? AI_DEFAULT_ENDPOINTS[id],
          displayName: stored?.displayName ?? AI_PROVIDERS[id].label,
          filters: stored?.filters ?? {
            chat: { mode: 'all', models: [] },
            completion: { mode: 'all', models: [] },
          },
          supportsTools: stored?.supportsTools ?? id !== 'custom',
          manualModels: stored?.manualModels ?? [],
          configured: isConfigured(id, stored),
          defaultModel: stored?.defaultModel ?? null,
          models: stored ? catalogue(id, stored) : [],
          modelsFetchedAt: stored?.modelsFetchedAt ?? null,
          error: stored?.error ?? null,
        };
      },
    );
    return {
      configured: (() => {
        const ref = settings.roleDefaults.assistant,
          provider = ref ? settings.providers[ref.provider] : undefined;
        return (
          !!ref &&
          !!provider &&
          isConfigured(ref.provider, provider) &&
          catalogue(ref.provider, provider).some(
            (model) => model.id === ref.model && roleAvailable(provider, model, 'assistant'),
          )
        );
      })(),
      autoSendProblems: settings.autoSendProblems,
      roleDefaults: settings.roleDefaults,
      completion: settings.completion,
      providers,
    };
  }
  async settings(): Promise<AISettings> {
    await this.queue;
    const settings = await this.read();
    this.normalize(settings);
    return this.view(settings);
  }

  async prepare(): Promise<void> {
    const settings = await this.settings();
    const prepared = new Set<AIProviderId>();
    for (const role of ['assistant', 'inlineCompletion', 'completion'] as const) {
      const ref = settings.roleDefaults[role];
      if (!ref || prepared.has(ref.provider)) continue;
      if (
        role === 'completion' &&
        (!settings.completion.enabled || !sameModel(ref, settings.completion.consentedModel))
      )
        continue;
      const provider = settings.providers.find((item) => item.id === ref.provider);
      if (!provider?.enabled || !provider.configured) continue;
      if (
        !provider.models.some(
          (model) =>
            model.id === ref.model &&
            supportsAIRole(model, role) &&
            isModelVisible(
              (role === 'completion' ? provider.filters?.completion : provider.filters?.chat) ?? {
                mode: 'all',
                models: [],
              },
              model.id,
            ),
        )
      )
        continue;
      prepared.add(ref.provider);
      await prepareSDKProvider(ref.provider);
    }
  }

  // ----- Validation helpers -----

  private providerArgument(value: unknown): AIProviderId {
    if (!record(value) || !isAIProviderId(value.provider))
      throw new AIError('INVALID_ARGUMENT', 'Choose a supported AI provider.');
    return value.provider;
  }
  private requireCipher(): void {
    if (!this.cipher.available())
      throw new AIError(
        'AI_STORAGE',
        'OS encryption is unavailable. Enable the OS credential service before saving a key.',
      );
  }
  private decrypt(provider: AIProviderId, stored: StoredProvider | undefined): string | null {
    if (!stored?.encryptedKey && !AI_PROVIDERS[provider].needsKey) return null;
    if (!stored?.encryptedKey)
      throw new AIError(
        'AI_KEY_REQUIRED',
        `Add a ${AI_PROVIDERS[provider].label} API key in AI settings first.`,
      );
    this.requireCipher();
    try {
      return this.cipher.decrypt(Buffer.from(stored.encryptedKey, 'base64'));
    } catch {
      throw new AIError(
        'AI_STORAGE',
        `The ${AI_PROVIDERS[provider].label} key cannot be decrypted on this OS account. Save a new key.`,
      );
    }
  }
  /** Fetches models with a bounded timeout and maps failures to safe messages. */
  private async fetchModels(access: ProviderAccess): Promise<AIModelInfo[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const models = cleanModelList(access.provider, await this.list(access, controller.signal));
      if (!models.length)
        throw new AIError(
          'AI_NO_MODELS',
          access.provider === 'ollama-local'
            ? 'Local Ollama has no models yet. Pull one (for example: ollama pull llama3.2), then refresh.'
            : `${AI_PROVIDERS[access.provider].label} returned no chat models for this key.`,
        );
      return models;
    } catch (error) {
      throw this.providerError(error, controller.signal, access);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ----- Settings operations -----

  /** Saves configuration without networking or decrypting an existing key. */
  async configureProvider(value: unknown): Promise<AISettings> {
    const provider = this.providerArgument(value);
    if (provider === 'codestral')
      throw new AIError('INVALID_ARGUMENT', 'Use the Mistral provider.');
    if (
      !record(value) ||
      typeof value.enabled !== 'boolean' ||
      typeof value.supportsTools !== 'boolean' ||
      !record(value.filters) ||
      !Array.isArray(value.manualModels) ||
      value.manualModels.length > 500 ||
      value.manualModels.some((id) => typeof id !== 'string' || !AI_MODEL_ID_PATTERN.test(id)) ||
      !(
        value.defaultModel === null ||
        (typeof value.defaultModel === 'string' && AI_MODEL_ID_PATTERN.test(value.defaultModel))
      ) ||
      (value.apiKey !== undefined && typeof value.apiKey !== 'string') ||
      (value.displayName !== undefined &&
        (typeof value.displayName !== 'string' || value.displayName.trim().length > 80))
    )
      throw new AIError('INVALID_ARGUMENT', 'Provide valid provider settings.');
    let endpoint: string;
    try {
      endpoint =
        provider === 'custom' && !value.enabled && value.endpoint === ''
          ? ''
          : validateAIEndpoint(value.endpoint);
    } catch (error) {
      throw new AIError(
        'INVALID_ARGUMENT',
        error instanceof Error ? error.message : 'Invalid provider endpoint.',
      );
    }
    const filters = {
      chat: visibility(value.filters.chat),
      completion: visibility(value.filters.completion),
    };
    const config = value as unknown as AIProviderConfiguration;
    let encryptedKey: string | undefined;
    if (config.apiKey !== undefined) {
      const key = config.apiKey.trim();
      if (key.length > 8192)
        throw new AIError('INVALID_ARGUMENT', 'API keys must be at most 8,192 characters.');
      if (key) this.requireCipher();
      encryptedKey = key ? this.cipher.encrypt(key).toString('base64') : '';
    }
    let invalidated: typeof this.activeContext = null;
    return this.update((settings) => {
      const previous = settings.providers[provider] ?? emptyProvider(provider);
      settings.providers[provider] = {
        ...previous,
        enabled: config.enabled,
        endpoint,
        displayName: config.displayName?.trim() || AI_PROVIDERS[provider].label,
        defaultModel: config.defaultModel,
        filters,
        supportsTools: config.supportsTools,
        manualModels: [...new Set(config.manualModels)],
        ...(encryptedKey !== undefined ? { encryptedKey } : {}),
        error: null,
        ...(previous.endpoint !== endpoint ? { models: [], modelsFetchedAt: null } : {}),
      };
      const active = this.activeContext;
      const next = settings.providers[provider]!;
      if (
        active?.model.provider === provider &&
        (previous.endpoint !== endpoint ||
          previous.encryptedKey !== next.encryptedKey ||
          // A running assistant request was built for the previous tool capability.
          (active.role === 'assistant' && previous.supportsTools !== next.supportsTools) ||
          !catalogue(provider, next).some(
            (model) => model.id === active.model.model && roleAvailable(next, model, active.role),
          ))
      )
        invalidated = active;
      if (previous.endpoint !== endpoint && settings.roleDefaults.completion?.provider === provider)
        settings.completion.consentedModel = null;
    }, provider).then((settings) => {
      if (invalidated && this.activeContext === invalidated) this.cancel();
      return settings;
    });
  }

  async saveProvider(value: unknown): Promise<AISettings> {
    const provider = this.providerArgument(value);
    if (provider === 'custom' || provider === 'codestral')
      throw new AIError(
        'INVALID_ARGUMENT',
        'Configure the provider endpoint and refresh models explicitly.',
      );
    const info = AI_PROVIDERS[provider];
    let key: string | null = null;
    if (info.needsKey) {
      const apiKey = record(value) ? value.apiKey : undefined;
      key = typeof apiKey === 'string' ? apiKey.trim() : '';
      // Credential formats change. The provider validates the key, not a local prefix rule.
      if (!key || key.length > 8192)
        throw new AIError('INVALID_ARGUMENT', `Paste a ${info.keyLabel} (up to 8,192 characters).`);
      this.requireCipher();
    }
    await this.queue;
    const connection = (await this.read()).providers[provider];
    const models = await this.fetchModels({
      provider,
      key,
      ...(connection?.endpoint ? { endpoint: connection.endpoint } : {}),
    });
    const encryptedKey = key ? this.cipher.encrypt(key).toString('base64') : '';
    return this.update((settings) => {
      const previous = settings.providers[provider] ?? emptyProvider(provider);
      if (previous.endpoint !== (connection?.endpoint ?? AI_DEFAULT_ENDPOINTS[provider]))
        throw new AIError('AI_CANCELLED', 'Provider configuration changed during setup.');
      settings.providers[provider] = {
        ...previous,
        encryptedKey,
        enabled: true,
        defaultModel: pickDefault(provider, models, previous.defaultModel),
        models,
        modelsFetchedAt: Date.now(),
        error: null,
      };
      if (Object.keys(settings.providers).length === 1) {
        const preferred = settings.providers[provider]?.defaultModel;
        const chosen = models.find((m) => m.id === preferred && supportsAIRole(m, 'assistant'));
        if (chosen) settings.roleDefaults.assistant ??= { provider, model: chosen.id };
      }
      if (!previous.enabled) this.prefillCompletion(settings, provider);
    });
  }
  async removeProvider(value: unknown): Promise<AISettings> {
    const provider = this.providerArgument(value);
    if (this.active || this.reserved)
      throw new AIError('AI_BUSY', 'Wait for the current AI request to finish.');
    return this.update((settings) => {
      delete settings.providers[provider];
    });
  }
  async refreshModels(value: unknown): Promise<AISettings> {
    const provider = this.providerArgument(value);
    await this.queue;
    const stored = (await this.read()).providers[provider];
    if (!isConfigured(provider, stored))
      throw new AIError('AI_KEY_REQUIRED', `Set up ${AI_PROVIDERS[provider].label} first.`);
    if (!stored?.enabled)
      throw new AIError('AI_PROVIDER_DISABLED', 'Enable this provider before refreshing models.');
    const key = this.decrypt(provider, stored);
    let models: AIModelInfo[];
    try {
      models = await this.fetchModels({
        provider,
        key,
        endpoint: stored.endpoint,
        supportsTools: stored.supportsTools,
      });
    } catch (error) {
      const message = error instanceof AIError ? error.message : 'Models could not be loaded.';
      await this.update((settings) => {
        const current = settings.providers[provider];
        if (current) current.error = message;
      });
      throw error;
    }
    return this.update((settings) => {
      const current = settings.providers[provider];
      if (!current) return;
      if (current.endpoint !== stored.endpoint || current.encryptedKey !== stored.encryptedKey)
        throw new AIError('AI_CANCELLED', 'Provider configuration changed during model refresh.');
      current.models = models;
      current.modelsFetchedAt = Date.now();
      current.error = null;
      if (settings.legacyGoogleDefaultPending)
        current.defaultModel = pickDefault(provider, models, current.defaultModel);
      if (provider === 'google' && settings.legacyGoogleDefaultPending && current.defaultModel) {
        settings.roleDefaults.assistant = { provider, model: current.defaultModel };
        this.prefillCompletion(settings, provider);
        delete settings.legacyGoogleDefaultPending;
      }
    });
  }
  private modelArgument(value: unknown): AIModelRef {
    if (
      !record(value) ||
      !isAIProviderId(value.provider) ||
      typeof value.model !== 'string' ||
      !AI_MODEL_ID_PATTERN.test(value.model)
    )
      throw new AIError('INVALID_ARGUMENT', 'Choose a model from the list.');
    return { provider: value.provider, model: value.model };
  }
  async setProviderDefault(value: unknown): Promise<AISettings> {
    const ref = this.modelArgument(value);
    return this.update((settings) => {
      const provider = settings.providers[ref.provider];
      if (!provider?.models.some((model) => model.id === ref.model))
        throw new AIError('INVALID_ARGUMENT', 'Choose a model from the list.');
      provider.defaultModel = ref.model;
    });
  }
  async setRoleDefault(value: unknown): Promise<AISettings> {
    if (!record(value) || !AI_ROLES.includes(value.role as AIRole))
      throw new AIError('INVALID_ARGUMENT', 'Choose an AI role.');
    const role = value.role as AIRole;
    const ref = value.model === null ? null : this.modelArgument(value.model);
    const before = await this.settings();
    let consent = false;
    if (
      role === 'completion' &&
      before.completion.enabled &&
      !sameModel(before.completion.consentedModel, ref) &&
      ref
    ) {
      consent =
        (await this.options.confirmAutomatic?.(
          ref,
          before.providers.find((provider) => provider.id === ref.provider)?.endpoint,
        )) ?? false;
      if (!consent) throw new AIError('AI_CANCELLED', 'Automatic model change cancelled.');
    }
    return this.update((settings) => {
      if (ref) {
        const provider = settings.providers[ref.provider];
        if (
          !isConfigured(ref.provider, provider) ||
          !provider ||
          !catalogue(ref.provider, provider).some(
            (m) => m.id === ref.model && roleAvailable(provider, m, role),
          )
        )
          throw new AIError('INVALID_ARGUMENT', 'Choose an available model for this role.');
      }
      settings.roleDefaults[role] = ref;
      if (role === 'completion' && (!sameModel(before.roleDefaults.completion, ref) || consent)) {
        if (
          consent &&
          ref &&
          settings.providers[ref.provider]?.endpoint !==
            before.providers.find((provider) => provider.id === ref.provider)?.endpoint
        )
          throw new AIError(
            'AI_CANCELLED',
            'The provider endpoint changed. Choose the model again.',
          );
        settings.completion.consentedModel = consent ? ref : null;
      }
    });
  }
  async setCompletionSettings(value: unknown): Promise<AISettings | null> {
    if (
      !record(value) ||
      typeof value.enabled !== 'boolean' ||
      typeof value.allowOutsideEnvironments !== 'boolean'
    )
      throw new AIError('INVALID_ARGUMENT', 'Choose completion settings.');
    const before = await this.settings();
    const model = before.roleDefaults.completion;
    const endpoint = model
      ? before.providers.find((provider) => provider.id === model.provider)?.endpoint
      : undefined;
    if (
      value.enabled &&
      model &&
      (!before.completion.enabled || !sameModel(before.completion.consentedModel, model))
    ) {
      if (!(await this.options.confirmAutomatic?.(model, endpoint))) return null;
    }
    return this.update((settings) => {
      if (
        value.enabled &&
        (model
          ? !sameModel(model, settings.roleDefaults.completion) ||
            settings.providers[model.provider]?.endpoint !== endpoint
          : settings.roleDefaults.completion !== null)
      )
        throw new AIError('AI_CANCELLED', 'The selected model changed. Enable suggestions again.');
      settings.completion = {
        enabled: value.enabled as boolean,
        allowOutsideEnvironments: value.allowOutsideEnvironments as boolean,
        consentedModel: value.enabled ? model : null,
      };
    });
  }
  async setAutoSend(value: unknown): Promise<AISettings> {
    if (!record(value) || typeof value.autoSendProblems !== 'boolean')
      throw new AIError('INVALID_ARGUMENT', 'Choose whether Problems prompts send automatically.');
    const autoSendProblems = value.autoSendProblems;
    return this.update((settings) => {
      settings.autoSendProblems = autoSendProblems;
    });
  }

  // ----- Local Ollama -----

  async ollamaStatus(): Promise<OllamaLocalStatus> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const version = await this.ollama.version(controller.signal);
      return {
        running: version !== null,
        version: version || null,
        installed: version !== null || (await this.ollama.find()) !== null,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  async startOllama(): Promise<OllamaLocalStatus> {
    const current = await this.ollamaStatus();
    if (current.running) return current;
    const executable = await this.ollama.find();
    if (!executable)
      throw new AIError(
        'AI_OLLAMA_MISSING',
        'Ollama was not found. Install it from ollama.com/download, then try again.',
      );
    this.ollama.start(executable);
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const status = await this.ollamaStatus();
      if (status.running) return status;
    }
    throw new AIError(
      'AI_OLLAMA_START',
      'Ollama did not respond after starting. Open the Ollama app manually and refresh.',
    );
  }

  // ----- Requests -----

  /** Resolves a renderer-chosen model to stored credentials; only listed models are allowed. */
  private async resolve(
    value: unknown,
    role: AIRole = 'assistant',
  ): Promise<{ access: ProviderAccess; model: string; info: AIModelInfo }> {
    const ref = this.modelArgument(value);
    await this.queue;
    const settings = await this.read();
    this.normalize(settings);
    const stored = settings.providers[ref.provider];
    if (stored && !stored.enabled)
      throw new AIError('AI_PROVIDER_DISABLED', 'This provider is disabled in AI settings.');
    if (!isConfigured(ref.provider, stored))
      throw new AIError(
        'AI_KEY_REQUIRED',
        `${AI_PROVIDERS[ref.provider].label} is not set up. Open AI settings to configure it.`,
      );
    const info = stored
      ? catalogue(ref.provider, stored).find(
          (model) => model.id === ref.model && roleAvailable(stored, model, role),
        )
      : undefined;
    if (!info)
      throw new AIError(
        'AI_MODEL_UNAVAILABLE',
        'That model is no longer in the provider’s list. Refresh models in AI settings.',
      );
    return {
      access: {
        provider: ref.provider,
        key: this.decrypt(ref.provider, stored),
        endpoint: stored?.endpoint,
        supportsTools: stored?.supportsTools,
      },
      model: ref.model,
      info,
    };
  }
  private timeoutFor(provider: AIProviderId): number {
    return provider === 'ollama-local' ? 180_000 : 90_000;
  }
  /** Runs one foreground operation (assistant or Ctrl+I) with resolved credentials. */
  async withProvider<T>(
    value: unknown,
    action: (access: ProviderAccess, model: string, signal: AbortSignal) => Promise<T>,
    role: AIRole = 'assistant',
  ): Promise<T> {
    this.preemptAutomatic();
    if (this.reserved || this.active)
      throw new AIError('AI_BUSY', 'Wait for the current AI request to finish.');
    this.reserved = true;
    const version = this.cancellationVersion;
    try {
      this.activeContext = { model: this.modelArgument(value), role };
      const { access, model } = await this.resolve(value, role);
      if (version !== this.cancellationVersion)
        throw new AIError('AI_CANCELLED', 'Request stopped.');
      const controller = new AbortController();
      this.active = controller;
      const timeout = setTimeout(() => controller.abort(), this.timeoutFor(access.provider));
      let stop: (() => void) | undefined;
      try {
        const cancelled = new Promise<never>((_resolve, reject) => {
          stop = () =>
            reject(new AIError('AI_CANCELLED', 'Request stopped or timed out. You can retry.'));
          controller.signal.addEventListener('abort', stop, { once: true });
        });
        const result = await Promise.race([action(access, model, controller.signal), cancelled]);
        if (controller.signal.aborted)
          throw new AIError('AI_CANCELLED', 'Request stopped or timed out. You can retry.');
        return result;
      } catch (error) {
        throw this.providerError(error, controller.signal, access);
      } finally {
        clearTimeout(timeout);
        if (stop) controller.signal.removeEventListener('abort', stop);
        this.active = null;
      }
    } finally {
      this.reserved = false;
      this.activeContext = null;
    }
  }
  private preemptAutomatic(): void {
    if (this.completionActive?.role === 'inlineCompletion')
      throw new AIError('AI_BUSY', 'Wait for the inline completion to finish.');
    this.completionActive?.controller.abort();
    this.completionActive = null;
  }
  cancelCompletion(value: unknown): void {
    if (
      !record(value) ||
      typeof value.requestId !== 'string' ||
      !/^[A-Za-z0-9-]{1,64}$/.test(value.requestId)
    )
      throw new AIError('INVALID_ARGUMENT', 'Provide a completion request identifier.');
    this.cancelledCompletions.set(value.requestId, Date.now() + 30_000);
    if (this.cancelledCompletions.size > 128)
      this.cancelledCompletions.delete(this.cancelledCompletions.keys().next().value!);
    if (this.completionActive?.requestId === value.requestId) {
      this.completionActive.controller.abort();
      this.completionActive = null;
    }
  }
  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    validateCompletionRequest(request);
    const selectedModel = this.modelArgument(request.model);
    for (const [id, expires] of this.cancelledCompletions)
      if (expires <= Date.now()) this.cancelledCompletions.delete(id);
    if (this.cancelledCompletions.has(request.requestId))
      throw new AIError('AI_CANCELLED', 'Completion cancelled before routing.');
    if (this.active || this.reserved)
      throw new AIError('AI_BUSY', 'The assistant is busy. Try completion again when it finishes.');
    if (this.completionActive) {
      if (request.role === 'inlineCompletion' && this.completionActive.role === 'completion')
        this.preemptAutomatic();
      else throw new AIError('AI_BUSY', 'A completion request is already running.');
    }
    const controller = new AbortController();
    const entry = {
      requestId: request.requestId,
      role: request.role,
      provider: selectedModel.provider,
      controller,
    };
    this.completionActive = entry;
    let timedOut = false;
    const timeout = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      completionTimeout(request.role, selectedModel),
    );
    let access: ProviderAccess | undefined;
    const startedAt = Date.now();
    let transport = 'chat';
    let responseCharacters: number | undefined;
    let finishReason: string | undefined;
    try {
      const settings = await this.settings();
      if (
        request.role === 'completion' &&
        (!settings.completion.enabled ||
          !sameModel(request.model, settings.roleDefaults.completion) ||
          !sameModel(request.model, settings.completion.consentedModel))
      )
        throw new AIError(
          'AI_CONSENT_REQUIRED',
          'Enable automatic suggestions for this model in AI settings first.',
        );
      const resolved = await this.resolve(request.model, request.role);
      access = resolved.access;
      transport = resolved.info.capabilities?.transport ?? 'chat';
      if (controller.signal.aborted) throw new AIError('AI_CANCELLED', 'Completion cancelled.');
      const generate = this.options.completion ?? completionGenerate;
      const pending = generate(access, resolved.model, {
        prefix: request.prefix,
        suffix: request.suffix,
        metadata: request.metadata,
        maxTokens: request.role === 'completion' ? 384 : 512,
        maxLines: request.role === 'completion' ? 10 : 20,
        signal: controller.signal,
        transport: resolved.info.capabilities?.transport ?? 'chat',
        onResultMeta: (metadata) => {
          finishReason = /^[A-Za-z0-9_-]{1,80}$/.test(metadata.finishReason)
            ? metadata.finishReason
            : 'other';
        },
      });
      const cancelled = new Promise<never>((_resolve, reject) =>
        controller.signal.addEventListener(
          'abort',
          () => reject(new AIError('AI_CANCELLED', 'Completion stopped or timed out.')),
          { once: true },
        ),
      );
      const raw = await Promise.race([pending, cancelled]);
      responseCharacters = typeof raw === 'string' ? raw.length : 0;
      if (controller.signal.aborted) throw new AIError('AI_CANCELLED', 'Completion cancelled.');
      let text: string;
      try {
        text = normalizeCompletion(raw, request);
      } catch (error) {
        if (
          request.role !== 'completion' ||
          !(error instanceof AIError) ||
          error.code !== 'AI_EMPTY'
        )
          throw error;
        this.options.onCompletionDiagnostic?.({
          provider: selectedModel.provider,
          model: selectedModel.model,
          transport,
          milliseconds: Date.now() - startedAt,
          finishReason,
          responseCharacters,
          normalization: 'empty',
        });
        return {
          requestId: request.requestId,
          modelVersion: request.modelVersion,
          offset: request.offset,
          text: '',
        };
      }
      this.options.onCompletionDiagnostic?.({
        provider: selectedModel.provider,
        model: selectedModel.model,
        transport,
        milliseconds: Date.now() - startedAt,
        finishReason,
        responseCharacters,
        normalization: 'accepted',
      });
      return {
        requestId: request.requestId,
        modelVersion: request.modelVersion,
        offset: request.offset,
        text,
      };
    } catch (error) {
      if (
        timedOut ||
        (!controller.signal.aborted &&
          !(error instanceof AIError && ['AI_CANCELLED', 'AI_BUSY'].includes(error.code)))
      )
        this.options.onCompletionDiagnostic?.({
          provider: selectedModel.provider,
          model: selectedModel.model,
          transport,
          milliseconds: Date.now() - startedAt,
          finishReason,
          responseCharacters,
          ...(error instanceof ProviderHTTPError ? { httpStatus: error.status } : {}),
          normalization: 'failed',
        });
      if (timedOut)
        throw new AIError(
          'AI_COMPLETION_TIMEOUT',
          'The selected model did not finish in time. Try a smaller model or regenerate.',
        );
      if (access) throw this.providerError(error, controller.signal, access);
      throw error;
    } finally {
      clearTimeout(timeout);
      if (this.completionActive === entry) this.completionActive = null;
    }
  }
  private providerError(error: unknown, signal: AbortSignal, access: ProviderAccess): AIError {
    if (error instanceof AIError) return error;
    const label = AI_PROVIDERS[access.provider].label;
    if (signal.aborted)
      return new AIError('AI_CANCELLED', 'Request stopped or timed out. You can retry.');
    const status =
      error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : undefined;
    const raw =
      error instanceof ProviderHTTPError
        ? error.detail
        : status !== undefined && error instanceof Error
          ? error.message
          : '';
    const detail = sanitize(raw, access.key);
    const suffix = detail ? ` (${detail})` : '';
    if (status === 429 || status === 529)
      return new AIError(
        'AI_RATE_LIMIT',
        `${label}’s rate or quota limit was reached. Switch to another model or wait and try again.`,
      );
    if (
      status === 401 ||
      status === 403 ||
      (status === 400 && access.provider === 'google' && /api key/i.test(raw))
    )
      return new AIError(
        'AI_KEY_INVALID',
        `${label} rejected the API key or model access. Check it in AI settings.${suffix}`,
      );
    if (status === 404)
      return new AIError(
        'AI_MODEL_UNAVAILABLE',
        `The selected model is unavailable from ${label}. Refresh models in AI settings.${suffix}`,
      );
    if (status === 400 || status === 422)
      return new AIError('AI_REQUEST_REJECTED', `${label} rejected the request.${suffix}`);
    if (status === 500 || status === 502 || status === 503 || status === 504)
      return new AIError(
        'AI_PROVIDER_ERROR',
        `${label} is temporarily unavailable (HTTP ${status}).${suffix} Try again shortly or choose another model.`,
      );
    if (status !== undefined)
      return new AIError(
        'AI_PROVIDER_ERROR',
        `${label} returned an error (HTTP ${status}).${suffix}`,
      );
    if (access.provider === 'ollama-local')
      return new AIError(
        'AI_NETWORK',
        'Local Ollama could not be reached. Start it from AI settings and try again.',
      );
    return new AIError(
      'AI_NETWORK',
      `${label} could not be reached. Check your connection and try again.`,
    );
  }
  cancel(): void {
    this.cancellationVersion++;
    this.active?.abort();
  }
}

export function validateCompletionRequest(value: unknown): asserts value is AICompletionRequest {
  if (
    !record(value) ||
    !['completion', 'inlineCompletion'].includes(String(value.role)) ||
    typeof value.requestId !== 'string' ||
    !/^[A-Za-z0-9-]{1,64}$/.test(value.requestId) ||
    typeof value.projectId !== 'string' ||
    !value.projectId ||
    value.projectId.length > 200 ||
    typeof value.path !== 'string' ||
    value.path.length > 4096 ||
    !/\.tex$/i.test(value.path) ||
    typeof value.revision !== 'string' ||
    value.revision.length > 200 ||
    !Number.isSafeInteger(value.modelVersion) ||
    Number(value.modelVersion) < 1 ||
    !Number.isSafeInteger(value.offset) ||
    Number(value.offset) < 0 ||
    typeof value.prefix !== 'string' ||
    typeof value.suffix !== 'string' ||
    typeof value.metadata !== 'string'
  )
    throw new AIError('INVALID_ARGUMENT', 'Provide a valid active TeX buffer completion snapshot.');
  const manual = value.role === 'inlineCompletion';
  if (
    value.prefix.length > (manual ? 16000 : 8000) ||
    value.suffix.length > (manual ? 4000 : 2000) ||
    value.metadata.length > (manual ? 4000 : 2000) ||
    value.prefix.length > Number(value.offset)
  )
    throw new AIError('INVALID_ARGUMENT', 'Completion context exceeds its bounded limits.');
}

export function normalizeCompletion(
  raw: string,
  request: Pick<AICompletionRequest, 'role' | 'prefix' | 'suffix'>,
): string {
  const limit = request.role === 'completion' ? 10000 : 20000;
  if (typeof raw !== 'string' || raw.length > limit)
    throw new AIError('AI_COMPLETION_OUTPUT', 'The completion response was too large.');
  let text = raw.replace(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/, '$1');
  if (request.prefix && text.startsWith(request.prefix)) text = text.slice(request.prefix.length);
  // Strip an exact echoed tail of the prefix, but do not guess at similar source.
  for (let size = Math.min(request.prefix.length, text.length); size >= 16; size--) {
    if (text.startsWith(request.prefix.slice(-size))) {
      text = text.slice(size);
      break;
    }
  }
  for (let size = Math.min(request.suffix.length, text.length); size > 0; size--) {
    if (text.endsWith(request.suffix.slice(0, size))) {
      text = text.slice(0, -size);
      break;
    }
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > (request.role === 'completion' ? 10 : 20))
    throw new AIError('AI_COMPLETION_OUTPUT', 'The completion exceeded its line limit.');
  const eol = request.prefix.includes('\r\n') || request.suffix.includes('\r\n') ? '\r\n' : '\n';
  text = lines.join(eol);
  if (!text.trim()) throw new AIError('AI_EMPTY', 'The model returned no new insertion text.');
  return text;
}
