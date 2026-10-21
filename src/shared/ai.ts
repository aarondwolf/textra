export const AI_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 31B' },
] as const;
export const CHAT_MODELS = AI_MODELS;
export const AGENT_MODELS = AI_MODELS;
export type AIModel = (typeof AI_MODELS)[number]['id'];
export type AIChatModel = AIModel;
export type AIAgentModel = AIModel;
export type AIMode = 'chat' | 'agent';
export const DEFAULT_CHAT_MODEL: AIChatModel = CHAT_MODELS[0].id;
export const DEFAULT_AGENT_MODEL: AIAgentModel = AGENT_MODELS[0].id;
export const AI_RATE_LIMIT_URL = 'https://aistudio.google.com/rate-limit';
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
  model: AIAgentModel;
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
