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
  'custom',
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
  custom: {
    id: 'custom',
    label: 'OpenAI-compatible',
    needsKey: false,
    keyLabel: 'API key (optional)',
    local: false,
    links: {},
  },
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
export const AI_DEFAULT_ENDPOINTS: Record<AIProviderId, string> = {
  google: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  mistral: 'https://api.mistral.ai/v1',
  codestral: 'https://codestral.mistral.ai/v1',
  deepseek: 'https://api.deepseek.com',
  openrouter: 'https://openrouter.ai/api/v1',
  'ollama-cloud': 'https://ollama.com',
  'ollama-local': OLLAMA_LOCAL_URL,
  custom: '',
};
export interface AIModelVisibility {
  mode: 'all' | 'include' | 'exclude';
  models: string[];
}
export interface AIProviderConfiguration {
  provider: AIProviderId;
  apiKey?: string;
  enabled: boolean;
  endpoint: string;
  displayName?: string;
  defaultModel: string | null;
  filters: { chat: AIModelVisibility; completion: AIModelVisibility };
  supportsTools: boolean;
  manualModels: string[];
}
export function isModelVisible(rule: AIModelVisibility | undefined, id: string): boolean {
  return (
    !rule ||
    rule.mode === 'all' ||
    (rule.mode === 'include' ? rule.models.includes(id) : !rule.models.includes(id))
  );
}
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
/** Assistant answers questions and proposes edits; Ctrl+I and automatic completion stay separate. */
export const AI_ROLES = ['assistant', 'completion', 'inlineCompletion'] as const;
export type AIRole = (typeof AI_ROLES)[number];
export type AICompletionRole = 'completion' | 'inlineCompletion';
export function isLocalAIModel(model: AIModelRef): boolean {
  return model.provider === 'ollama-local' && !/cloud/i.test(model.model);
}
/** CPU inference needs more time; local context is separately kept small. */
export function completionTimeout(role: AICompletionRole, model: AIModelRef): number {
  return isLocalAIModel(model)
    ? role === 'completion'
      ? 30_000
      : 30_000
    : role === 'completion'
      ? 10_000
      : 15_000;
}
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
export interface AIInlineEditRequest {
  requestId: string;
  model: AIModelRef;
  projectId: string;
  path: string;
  revision: string;
  modelVersion: number;
  offset: number;
  endOffset: number;
  prefix: string;
  suffix: string;
  metadata: string;
  instruction: string;
  selection: string;
}
export interface AIInlineEditResponse {
  requestId: string;
  modelVersion: number;
  offset: number;
  endOffset: number;
  text: string;
}
export function supportsAIRole(model: AIModelInfo, role: AIRole): boolean {
  return role === 'assistant' || role === 'inlineCompletion'
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
export const AGENT_SOURCE_LIMIT = 64_000;
/** Immutable snapshot supplied by the editor, never a model-selected path. */
export interface AIAgentDocument {
  projectId: string;
  path: string;
  content: string;
  revision: string;
}
/** Opaque handle for the captured active document. Its contents are never sent automatically. */
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
/** Application-owned record of what the user did with a proposal from that assistant turn. */
export const AI_REVIEW_OUTCOMES = ['applied', 'partial', 'rejected'] as const;
export type AIReviewOutcome = (typeof AI_REVIEW_OUTCOMES)[number];
/** One typed assistant request. Manual Send may attach the captured document context. */
export interface AIAssistantRequest {
  requestId: string;
  model: AIModelRef;
  messages: import('./api').AIMessage[];
  /** Present only for a manual send that authorizes on-demand access to the captured document. */
  contextId?: string;
}
export type AIDocumentAccess = 'none' | 'authorized' | 'unsupported';
export interface AIAssistantResult {
  text: string;
  proposal: AIEditProposal | null;
  documentAccess: AIDocumentAccess;
}
/** Display-only stream events. Tool arguments/results and provider payloads never appear here. */
export type AIAssistantEvent =
  | { requestId: string; type: 'text'; text: string }
  | { requestId: string; type: 'reasoning'; text: string }
  | { requestId: string; type: 'status'; message: string };
export const AI_ASSISTANT_STATUS_LIMIT = 120;
/** Local transcript; no credentials, live requests, tool transcripts or pending edits persist. */
export interface AIStoredChat {
  id: string;
  title: string;
  updatedAt: number;
  messages: import('./api').AIMessage[];
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
/** Streamed Ctrl+I preview text (cumulative, bounded). */
export interface AIInlineEditChunk {
  requestId: string;
  text: string;
}
