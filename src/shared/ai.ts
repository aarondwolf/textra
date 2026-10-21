/** Every provider TeXtra knows how to call. Each one has its own request format. */
export const AI_PROVIDER_IDS = [
  'google',
  'openai',
  'anthropic',
  'ollama-cloud',
  'ollama-local',
] as const;
export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];
export type AIProviderLink = 'keys' | 'limits' | 'download';
export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  /** Short wire-format description shown on the provider card. */
  protocol: string;
  needsKey: boolean;
  keyLabel: string;
  links: Partial<Record<AIProviderLink, string>>;
  /** True when requests never leave this computer. */
  local: boolean;
}
export const AI_PROVIDERS: Record<AIProviderId, AIProviderInfo> = {
  google: {
    id: 'google',
    label: 'Google Gemini',
    protocol: 'Gemini API (generateContent)',
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
    protocol: 'OpenAI Chat Completions',
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
    protocol: 'Anthropic Messages API',
    needsKey: true,
    keyLabel: 'Anthropic API key',
    links: {
      keys: 'https://console.anthropic.com/settings/keys',
      limits: 'https://console.anthropic.com/settings/limits',
    },
    local: false,
  },
  'ollama-cloud': {
    id: 'ollama-cloud',
    label: 'Ollama Cloud',
    protocol: 'Ollama API (ollama.com)',
    needsKey: true,
    keyLabel: 'Ollama API key',
    links: { keys: 'https://ollama.com/settings/keys', limits: 'https://ollama.com/settings' },
    local: false,
  },
  'ollama-local': {
    id: 'ollama-local',
    label: 'Local Ollama',
    protocol: 'Ollama API (this computer)',
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
