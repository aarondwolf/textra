/** Supported providers and their setup details; transport stays in main. */
export const AI_PROVIDER_IDS = [
  'google',
  'openai',
  'anthropic',
  'mistral',
  'codestral',
  'deepseek',
  'openrouter',
  'ollama-cloud',
  'ollama-local',
] as const;
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];
export type AIProviderLink = 'keys' | 'limits' | 'download';
export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  needsKey: boolean;
  keyLabel: string;
  setupHint?: string;
  /** Setup cards can nest a dedicated credential profile inside its vendor card. */
  parent?: AIProviderId;
  links: Partial<Record<AIProviderLink, string>>;
  /** Uses a loopback server; model IDs marked cloud still route to Ollama Cloud. */
  local: boolean;
}
export const AI_PROVIDERS: Record<AIProviderId, AIProviderInfo> = {
  google: {
    id: 'google',
    label: 'Google Gemini',
    needsKey: true,
    keyLabel: 'Google AI Studio API key',
    links: {
      keys: 'https://aistudio.google.com/apikey',
      limits: 'https://aistudio.google.com/rate-limit',
    },
    local: false,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    needsKey: true,
    keyLabel: 'OpenAI API key',
    links: {
      keys: 'https://platform.openai.com/api-keys',
      limits: 'https://platform.openai.com/settings/organization/limits',
    },
    local: false,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    needsKey: true,
    keyLabel: 'Anthropic API key',
    links: {
      keys: 'https://console.anthropic.com/settings/keys',
      limits: 'https://console.anthropic.com/settings/limits',
    },
    local: false,
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    needsKey: true,
    keyLabel: 'Mistral API key',
    links: {
      keys: 'https://console.mistral.ai/api-keys',
      limits: 'https://console.mistral.ai/limits',
    },
    local: false,
  },
  codestral: {
    id: 'codestral',
    label: 'Codestral',
    needsKey: true,
    keyLabel: 'Codestral API key',
    setupHint:
      'Use a key for the dedicated Codestral service. This connection is separate from Mistral above.',
    parent: 'mistral',
    links: {
      keys: 'https://console.mistral.ai/codestral',
      limits: 'https://console.mistral.ai/codestral',
    },
    local: false,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    needsKey: true,
    keyLabel: 'DeepSeek API key',
    links: {
      keys: 'https://platform.deepseek.com/api_keys',
      limits: 'https://platform.deepseek.com/usage',
    },
    local: false,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    needsKey: true,
    keyLabel: 'OpenRouter API key',
    setupHint: 'Routes messages through OpenRouter to the selected model’s provider.',
    links: {
      keys: 'https://openrouter.ai/settings/keys',
      limits: 'https://openrouter.ai/settings/credits',
    },
    local: false,
  },
  'ollama-cloud': {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    needsKey: true,
    keyLabel: 'Ollama API key',
    links: { keys: 'https://ollama.com/settings/keys', limits: 'https://ollama.com/settings' },
    local: false,
  },
  'ollama-local': {
    id: 'ollama-local',
    label: 'Local Ollama',
    needsKey: false,
    keyLabel: '',
    links: { download: 'https://ollama.com/download' },
    local: true,
  },
};
export const OLLAMA_LOCAL_URL = 'http://127.0.0.1:11434';
export function isAIProviderId(value: unknown): value is AIProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}
/** A provider-qualified model. Model ids are only unique within one provider. */
export interface AIModelRef {
  provider: AIProviderId;
  model: string;
}
export interface AIModelInfo {
  id: string;
  label: string;
  capabilities?: { chat: boolean; completion: boolean; transport: AICompletionTransport };
}
export type AICompletionTransport = 'chat' | 'mistral-fim' | 'ollama-generate';
export const AI_ROLES = ['chat', 'agent', 'completion', 'inlineCompletion'] as const;
export type AIRole = (typeof AI_ROLES)[number];
export type AICompletionRole = 'completion' | 'inlineCompletion';
export type AIRoleDefaults = Record<AIRole, AIModelRef | null>;
export interface AIAutomaticSettings {
  enabled: boolean;
  allowOutsideEnvironments: boolean;
  consentedModel: AIModelRef | null;
}
export interface AICompletionRequest {
  requestId: string;
  role: AICompletionRole;
  model: AIModelRef;
  projectId: string;
  path: string;
  revision: string;
  modelVersion: number;
  offset: number;
  prefix: string;
  suffix: string;
  metadata: string;
}
export interface AICompletionResponse {
  requestId: string;
  modelVersion: number;
  offset: number;
  text: string;
}
export function supportsAIRole(model: AIModelInfo, role: AIRole): boolean {
  return role === 'chat' || role === 'agent'
    ? (model.capabilities?.chat ?? true)
    : (model.capabilities?.completion ?? true);
}
export const AI_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;
export function modelKey(ref: AIModelRef): string {
  return `${ref.provider}:${ref.model}`;
}
export function sameModel(
  left: AIModelRef | null | undefined,
  right: AIModelRef | null | undefined,
) {
  return Boolean(left && right && left.provider === right.provider && left.model === right.model);
}
export type AIMode = 'chat' | 'agent';
export const AGENT_SOURCE_LIMIT = 64_000;
/** Immutable snapshot supplied by the editor, never a model-selected path. */
export interface AIAgentDocument {
  projectId: string;
  path: string;
  content: string;
  revision: string;
}
export interface AIAgentContext {
  contextId: string;
  path: string;
}
export interface AIEditProposal extends AIAgentDocument {
  id: string;
  contextId: string;
  modified: string;
  summary: string;
}
export interface AIAgentRequest {
  contextId: string;
  prompt: string;
  model: AIModelRef;
  requestId: string;
  messages?: import('./api').AIMessage[];
}
/** Local transcript; no credentials, live requests, or pending edits are persisted. */
export interface AIStoredChat {
  id: string;
  title: string;
  updatedAt: number;
  messages: import('./api').AIMessage[];
}
export interface AIAgentResult {
  text: string;
  proposal: AIEditProposal | null;
}
export interface AIAgentReviewRequest {
  id: string;
  contextId: string;
  approveHunkIds: string[];
  rejectHunkIds: string[];
}
/** One review decision, with the unreviewed proposal rebased onto the accepted buffer. */
export interface AIAgentReviewResult {
  applied: AIEditProposal | null;
  remaining: AIEditProposal | null;
  context: AIAgentContext;
}
