import { GoogleGenAI, type Content, type Part } from '@google/genai';
import type { AIMessage } from '../../shared/api';
import { OLLAMA_LOCAL_URL, type AIModelInfo, type AIProviderId } from '../../shared/ai';
import { cleanModelList, hasTextOutput, isTextModelId } from './ai-models';

/**
 * Wire-format adapters. Each provider speaks its own protocol: Gemini uses
 * generateContent, OpenAI/Mistral/DeepSeek/OpenRouter use Chat Completions,
 * Anthropic uses Messages, and
 * Ollama (cloud or local) uses its native /api/chat. Endpoints are fixed here;
 * no provider-selected or renderer-selected URL is ever requested.
 */
export interface ProviderAccess {
  provider: AIProviderId;
  /** Decrypted key, or null for local Ollama. Never logged. */
  key: string | null;
}
export interface ChatRequest {
  system: string;
  messages: AIMessage[];
  maxTokens: number;
  signal: AbortSignal;
  /** Receives the cumulative response text. */
  onText?: (text: string) => void;
}
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCall {
  /** Provider call id when the protocol has one (OpenAI, Anthropic, sometimes Gemini). */
  id?: string;
  name: string;
  args: unknown;
}
export type AgentItem =
  | { role: 'user'; text: string }
  /** raw keeps the provider's own message so signatures and blocks replay unchanged. */
  | { role: 'assistant'; text: string; calls: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: { id?: string; name: string; result: Record<string, unknown> }[] };
export interface AgentTurn {
  text: string;
  calls: ToolCall[];
  raw?: unknown;
}
export interface AgentRequest {
  system: string;
  items: AgentItem[];
  tools: ToolSpec[];
  maxTokens: number;
  signal: AbortSignal;
}

export class ProviderHTTPError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`Provider returned HTTP ${status}`);
  }
}

const OUTPUT_LIMIT = 32_000;
const GOOGLE_URL = 'https://generativelanguage.googleapis.com/';
const OPENAI_URL = 'https://api.openai.com/v1';
const COMPATIBLE_URLS = {
  openai: OPENAI_URL,
  mistral: 'https://api.mistral.ai/v1',
  deepseek: 'https://api.deepseek.com',
  openrouter: 'https://openrouter.ai/api/v1',
} as const;
function compatibleBase(provider: AIProviderId): string {
  if (
    provider === 'openai' ||
    provider === 'mistral' ||
    provider === 'deepseek' ||
    provider === 'openrouter'
  )
    return COMPATIBLE_URLS[provider];
  throw new Error('Unsupported Chat Completions provider.');
}
function routingOptions(access: ProviderAccess): Record<string, unknown> {
  return access.provider === 'openrouter'
    ? { provider: { require_parameters: true, allow_fallbacks: false }, modalities: ['text'] }
    : {};
}
function completionLimit(access: ProviderAccess, maxTokens: number): Record<string, number> {
  return access.provider === 'openai'
    ? { max_completion_tokens: Math.max(maxTokens, 8192) }
    : { max_tokens: maxTokens };
}
const ANTHROPIC_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const OLLAMA_CLOUD_URL = 'https://ollama.com';

function requireKey(access: ProviderAccess): string {
  if (!access.key) throw new ProviderHTTPError(401, 'An API key is required.');
  return access.key;
}
function ollamaBase(provider: AIProviderId): string {
  return provider === 'ollama-local' ? OLLAMA_LOCAL_URL : OLLAMA_CLOUD_URL;
}
function headers(access: ProviderAccess): Record<string, string> {
  const result: Record<string, string> = { 'content-type': 'application/json' };
  if (access.provider in COMPATIBLE_URLS || access.provider === 'ollama-cloud')
    result.authorization = `Bearer ${requireKey(access)}`;
  if (access.provider === 'openrouter') result['X-OpenRouter-Title'] = 'TeXtra';
  if (access.provider === 'anthropic') {
    result['x-api-key'] = requireKey(access);
    result['anthropic-version'] = ANTHROPIC_VERSION;
  }
  if (access.provider === 'google') result['x-goog-api-key'] = requireKey(access);
  return result;
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
async function errorDetail(response: Response): Promise<string> {
  let text: string;
  try {
    text = (await response.text()).slice(0, 4000);
  } catch {
    return '';
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (record(parsed)) {
      const error = parsed.error;
      if (typeof error === 'string') return error;
      if (record(error) && typeof error.message === 'string') return error.message;
      if (typeof parsed.message === 'string') return parsed.message;
    }
  } catch {
    /* Not JSON. */
  }
  return text;
}
async function request(
  url: string,
  access: ProviderAccess,
  signal: AbortSignal,
  body?: unknown,
): Promise<Response> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: headers(access),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
    redirect: 'error',
  });
  if (!response.ok) throw new ProviderHTTPError(response.status, await errorDetail(response));
  return response;
}
async function json(
  url: string,
  access: ProviderAccess,
  signal: AbortSignal,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await request(url, access, signal, body);
  const value: unknown = await response.json();
  if (!record(value))
    throw new ProviderHTTPError(502, 'The provider returned an invalid response.');
  return value;
}
/** Yields complete lines from a streamed body without buffering unbounded output. */
async function* lines(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) throw new ProviderHTTPError(502, 'Streamed line too long.');
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
async function* sse(response: Response, signal: AbortSignal): AsyncGenerator<unknown> {
  for await (const line of lines(response, signal)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      yield JSON.parse(data);
    } catch {
      /* Ignore keep-alive or malformed events. */
    }
  }
}
function collector(request: ChatRequest) {
  let text = '';
  return {
    add(delta: unknown): boolean {
      if (typeof delta !== 'string' || !delta) return false;
      text += delta.slice(0, OUTPUT_LIMIT - text.length);
      request.onText?.(text);
      return text.length >= OUTPUT_LIMIT;
    },
    get text() {
      return text;
    },
  };
}

// ----- Model listing -----

function sortByLabel(models: AIModelInfo[]): AIModelInfo[] {
  return models.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { numeric: true }),
  );
}
export async function listModels(
  access: ProviderAccess,
  signal: AbortSignal,
): Promise<AIModelInfo[]> {
  switch (access.provider) {
    case 'google': {
      const models: AIModelInfo[] = [];
      let pageToken = '';
      for (let page = 0; page < 5; page++) {
        const query = new URLSearchParams({ pageSize: '1000' });
        if (pageToken) query.set('pageToken', pageToken);
        const value = await json(`${GOOGLE_URL}v1beta/models?${query}`, access, signal);
        for (const item of Array.isArray(value.models) ? value.models : []) {
          if (!record(item) || typeof item.name !== 'string') continue;
          const methods = Array.isArray(item.supportedGenerationMethods)
            ? item.supportedGenerationMethods
            : [];
          const id = item.name.replace(/^models\//, '');
          if (
            !methods.includes('generateContent') ||
            !isTextModelId('google', id) ||
            !hasTextOutput(item.outputModalities ?? item.output_modalities)
          )
            continue;
          models.push({
            id,
            label: typeof item.displayName === 'string' && item.displayName ? item.displayName : id,
          });
        }
        pageToken = typeof value.nextPageToken === 'string' ? value.nextPageToken : '';
        if (!pageToken) break;
      }
      return cleanModelList(access.provider, models);
    }
    case 'openai':
    case 'mistral':
    case 'deepseek': {
      const value = await json(`${compatibleBase(access.provider)}/models`, access, signal);
      const data = Array.isArray(value.data) ? value.data : [];
      return sortByLabel(
        cleanModelList(
          access.provider,
          data
            .filter(
              (item): item is Record<string, unknown> & { id: string } =>
                record(item) &&
                typeof item.id === 'string' &&
                isTextModelId(access.provider, item.id) &&
                hasTextOutput(item.output_modalities) &&
                item.archived !== true &&
                (access.provider !== 'mistral' ||
                  (record(item.capabilities) && item.capabilities.completion_chat === true)),
            )
            .map((item) => ({
              id: item.id,
              label: typeof item.name === 'string' ? item.name : item.id,
            })),
        ),
      );
    }
    case 'openrouter': {
      // The public catalogue does not validate keys or respect account preferences.
      const value = await json(
        `${compatibleBase(access.provider)}/models/user?output_modalities=text`,
        access,
        signal,
      );
      return sortByLabel(
        cleanModelList(
          access.provider,
          (Array.isArray(value.data) ? value.data : [])
            .filter(
              (item): item is Record<string, unknown> & { id: string } =>
                record(item) &&
                typeof item.id === 'string' &&
                record(item.architecture) &&
                Array.isArray(item.architecture.output_modalities) &&
                hasTextOutput(item.architecture.output_modalities),
            )
            .map((item) => ({
              id: item.id,
              label: typeof item.name === 'string' ? item.name : item.id,
            })),
        ),
      );
    }
    case 'anthropic': {
      const value = await json(`${ANTHROPIC_URL}/models?limit=1000`, access, signal);
      const data = Array.isArray(value.data) ? value.data : [];
      return cleanModelList(
        access.provider,
        data
          .filter((item): item is Record<string, unknown> & { id: string } =>
            Boolean(record(item) && typeof item.id === 'string'),
          )
          .map((item) => ({
            id: item.id,
            label:
              typeof item.display_name === 'string' && item.display_name
                ? item.display_name
                : item.id,
          })),
      );
    }
    case 'ollama-cloud':
    case 'ollama-local': {
      const value = await json(`${ollamaBase(access.provider)}/api/tags`, access, signal);
      const data = Array.isArray(value.models) ? value.models : [];
      const candidates = cleanModelList(
        access.provider,
        data
          .map((item) => (record(item) ? (item.model ?? item.name) : undefined))
          .filter((id): id is string => typeof id === 'string')
          .map((id) => ({ id, label: id.replace(/:latest$/, '') })),
      );
      const models: AIModelInfo[] = [];
      // Query small batches; only model names are shared, never document content.
      for (let index = 0; index < candidates.length; index += 4) {
        const batch = await Promise.all(
          candidates.slice(index, index + 4).map(async (model) => {
            try {
              const details = await json(
                `${ollamaBase(access.provider)}/api/show`,
                access,
                signal,
                { model: model.id },
              );
              return Array.isArray(details.capabilities) &&
                !details.capabilities.includes('completion')
                ? null
                : model;
            } catch (error) {
              // Older/cloud servers may not expose metadata. Keep the ID fallback.
              if (error instanceof ProviderHTTPError && [404, 405].includes(error.status))
                return model;
              throw error;
            }
          }),
        );
        models.push(...batch.filter((model): model is AIModelInfo => model !== null));
      }
      return sortByLabel(models);
    }
  }
}

/** Local Ollama answers /api/version without authentication when it is running. */
export async function ollamaVersion(signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(`${OLLAMA_LOCAL_URL}/api/version`, { signal, redirect: 'error' });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return record(value) && typeof value.version === 'string' ? value.version.slice(0, 40) : '';
  } catch {
    return null;
  }
}

// ----- Conversational chat (streamed) -----

function googleClient(access: ProviderAccess): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: requireKey(access),
    vertexai: false,
    httpOptions: {
      baseUrl: GOOGLE_URL,
      timeout: 120_000,
      retryOptions: { attempts: 1 },
      fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
    },
  });
}

export async function streamChat(
  access: ProviderAccess,
  model: string,
  chat: ChatRequest,
): Promise<string> {
  const output = collector(chat);
  const { signal } = chat;
  switch (access.provider) {
    case 'google': {
      const stream = await googleClient(access).models.generateContentStream({
        model,
        contents: chat.messages.map(({ role, text }) => ({ role, parts: [{ text }] })),
        config: {
          abortSignal: signal,
          maxOutputTokens: chat.maxTokens,
          automaticContinuation: false,
          systemInstruction: chat.system,
        },
      });
      for await (const chunk of stream) {
        signal.throwIfAborted();
        if (output.add(chunk.text)) break;
      }
      return output.text;
    }
    case 'openai':
    case 'mistral':
    case 'openrouter':
    case 'deepseek': {
      const response = await request(
        `${compatibleBase(access.provider)}/chat/completions`,
        access,
        signal,
        {
          model,
          stream: true,
          ...completionLimit(access, chat.maxTokens),
          ...routingOptions(access),
          messages: [
            { role: 'system', content: chat.system },
            ...chat.messages.map(({ role, text }) => ({
              role: role === 'model' ? 'assistant' : 'user',
              content: text,
            })),
          ],
        },
      );
      for await (const event of sse(response, signal)) {
        if (!record(event)) continue;
        if (record(event.error))
          throw new ProviderHTTPError(500, String(event.error.message ?? 'Stream error.'));
        const choice = Array.isArray(event.choices) ? event.choices[0] : undefined;
        if (record(choice) && record(choice.delta) && output.add(choice.delta.content)) break;
      }
      return output.text;
    }
    case 'anthropic': {
      const response = await request(`${ANTHROPIC_URL}/messages`, access, signal, {
        model,
        stream: true,
        max_tokens: chat.maxTokens,
        system: chat.system,
        messages: chat.messages.map(({ role, text }) => ({
          role: role === 'model' ? 'assistant' : 'user',
          content: text,
        })),
      });
      for await (const event of sse(response, signal)) {
        if (!record(event)) continue;
        if (event.type === 'error')
          throw new ProviderHTTPError(
            record(event.error) && event.error.type === 'overloaded_error' ? 529 : 500,
            record(event.error) ? String(event.error.message ?? '') : '',
          );
        if (
          event.type === 'content_block_delta' &&
          record(event.delta) &&
          event.delta.type === 'text_delta' &&
          output.add(event.delta.text)
        )
          break;
      }
      return output.text;
    }
    case 'ollama-cloud':
    case 'ollama-local': {
      const response = await request(`${ollamaBase(access.provider)}/api/chat`, access, signal, {
        model,
        stream: true,
        options: { num_predict: chat.maxTokens },
        messages: [
          { role: 'system', content: chat.system },
          ...chat.messages.map(({ role, text }) => ({
            role: role === 'model' ? 'assistant' : 'user',
            content: text,
          })),
        ],
      });
      for await (const line of lines(response, signal)) {
        if (!line.trim()) continue;
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (!record(event)) continue;
        if (typeof event.error === 'string') throw new ProviderHTTPError(500, event.error);
        if (record(event.message) && output.add(event.message.content)) break;
        if (event.done === true) break;
      }
      return output.text;
    }
  }
}

// ----- Agent turns with tool calling (not streamed) -----

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return {};
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Converts the neutral transcript to Gemini contents, replaying raw model content as sent. */
export function toGoogleContents(items: AgentItem[]): Content[] {
  return items.map((item): Content => {
    if (item.role === 'user') return { role: 'user', parts: [{ text: item.text }] };
    if (item.role === 'assistant') {
      if (item.raw) return item.raw as Content;
      const parts: Part[] = item.text ? [{ text: item.text }] : [];
      for (const call of item.calls)
        parts.push({
          functionCall: {
            name: call.name,
            args: record(call.args) ? call.args : {},
            ...(call.id ? { id: call.id } : {}),
          },
        });
      return { role: 'model', parts };
    }
    return {
      role: 'user',
      parts: item.results.map(({ id, name, result }) => ({
        functionResponse: { name, ...(id ? { id } : {}), response: result },
      })),
    };
  });
}
/** Reads text and function calls from Gemini content, keeping it raw for replay. */
export function fromGoogleContent(content: Content | undefined): AgentTurn {
  if (!content?.parts?.length) return { text: '', calls: [] };
  let text = '';
  const calls: ToolCall[] = [];
  for (const part of content.parts) {
    if (part.text && !part.thought) text += part.text;
    if (part.functionCall)
      calls.push({
        ...(part.functionCall.id ? { id: part.functionCall.id } : {}),
        name: part.functionCall.name ?? '',
        args: part.functionCall.args,
      });
  }
  // Preserve the provider's complete content, including thought signatures.
  return { text, calls, raw: content };
}

async function googleTurn(
  access: ProviderAccess,
  model: string,
  agent: AgentRequest,
): Promise<AgentTurn> {
  const response = await googleClient(access).models.generateContent({
    model,
    contents: toGoogleContents(agent.items),
    config: {
      abortSignal: agent.signal,
      maxOutputTokens: agent.maxTokens,
      automaticContinuation: false,
      tools: [
        {
          functionDeclarations: agent.tools.map(({ name, description, parameters }) => ({
            name,
            description,
            parametersJsonSchema: parameters,
          })),
        },
      ],
      systemInstruction: agent.system,
    },
  });
  return fromGoogleContent(response.candidates?.[0]?.content);
}

async function compatibleTurn(
  access: ProviderAccess,
  model: string,
  agent: AgentRequest,
): Promise<AgentTurn> {
  const messages: unknown[] = [{ role: 'system', content: agent.system }];
  for (const item of agent.items) {
    if (item.role === 'user') messages.push({ role: 'user', content: item.text });
    else if (item.role === 'assistant')
      messages.push({
        role: 'assistant',
        content: item.text || null,
        ...(access.provider === 'deepseek' &&
        record(item.raw) &&
        typeof item.raw.reasoning_content === 'string'
          ? { reasoning_content: item.raw.reasoning_content }
          : {}),
        ...(access.provider === 'openrouter' && record(item.raw)
          ? {
              ...(Array.isArray(item.raw.reasoning_details)
                ? { reasoning_details: item.raw.reasoning_details }
                : {}),
              ...(typeof item.raw.reasoning === 'string' ? { reasoning: item.raw.reasoning } : {}),
            }
          : {}),
        ...(item.calls.length
          ? {
              tool_calls: item.calls.map((call, index) => ({
                id: call.id ?? `call_${index}`,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
              })),
            }
          : {}),
      });
    else
      for (const [index, result] of item.results.entries())
        messages.push({
          role: 'tool',
          tool_call_id: result.id ?? `call_${index}`,
          content: JSON.stringify(result.result),
        });
  }
  const value = await json(
    `${compatibleBase(access.provider)}/chat/completions`,
    access,
    agent.signal,
    {
      model,
      messages,
      ...completionLimit(access, agent.maxTokens),
      ...routingOptions(access),
      tools: agent.tools.map(({ name, description, parameters }) => ({
        type: 'function',
        function: { name, description, parameters },
      })),
    },
  );
  const choice = Array.isArray(value.choices) ? value.choices[0] : undefined;
  const message = record(choice) && record(choice.message) ? choice.message : {};
  const calls: ToolCall[] = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .filter(record)
    .map((call) => ({
      ...(typeof call.id === 'string' ? { id: call.id } : {}),
      name: record(call.function) ? String(call.function.name ?? '') : '',
      args: record(call.function) ? parseArguments(call.function.arguments) : null,
    }));
  return {
    text: typeof message.content === 'string' ? message.content : '',
    calls,
    ...(access.provider === 'deepseek' || access.provider === 'openrouter' ? { raw: message } : {}),
  };
}

async function anthropicTurn(
  access: ProviderAccess,
  model: string,
  agent: AgentRequest,
): Promise<AgentTurn> {
  const messages: unknown[] = agent.items.map((item) => {
    if (item.role === 'user') return { role: 'user', content: item.text };
    if (item.role === 'assistant')
      return {
        role: 'assistant',
        content: Array.isArray(item.raw)
          ? item.raw
          : [
              ...(item.text ? [{ type: 'text', text: item.text }] : []),
              ...item.calls.map((call, index) => ({
                type: 'tool_use',
                id: call.id ?? `toolu_${index}`,
                name: call.name,
                input: record(call.args) ? call.args : {},
              })),
            ],
      };
    return {
      role: 'user',
      content: item.results.map((result, index) => ({
        type: 'tool_result',
        tool_use_id: result.id ?? `toolu_${index}`,
        content: JSON.stringify(result.result),
      })),
    };
  });
  const value = await json(`${ANTHROPIC_URL}/messages`, access, agent.signal, {
    model,
    max_tokens: agent.maxTokens,
    system: agent.system,
    messages,
    tools: agent.tools.map(({ name, description, parameters }) => ({
      name,
      description,
      input_schema: parameters,
    })),
  });
  const blocks = (Array.isArray(value.content) ? value.content : []).filter(record);
  let text = '';
  const calls: ToolCall[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') text += block.text;
    if (block.type === 'tool_use')
      calls.push({
        ...(typeof block.id === 'string' ? { id: block.id } : {}),
        name: String(block.name ?? ''),
        args: block.input,
      });
  }
  return { text, calls, raw: blocks };
}

async function ollamaTurn(
  access: ProviderAccess,
  model: string,
  agent: AgentRequest,
): Promise<AgentTurn> {
  const messages: unknown[] = [{ role: 'system', content: agent.system }];
  for (const item of agent.items) {
    if (item.role === 'user') messages.push({ role: 'user', content: item.text });
    else if (item.role === 'assistant')
      messages.push({
        role: 'assistant',
        content: item.text,
        ...(item.calls.length
          ? {
              tool_calls: item.calls.map((call) => ({
                function: { name: call.name, arguments: record(call.args) ? call.args : {} },
              })),
            }
          : {}),
      });
    else
      for (const result of item.results)
        messages.push({
          role: 'tool',
          tool_name: result.name,
          content: JSON.stringify(result.result),
        });
  }
  const value = await json(`${ollamaBase(access.provider)}/api/chat`, access, agent.signal, {
    model,
    stream: false,
    messages,
    options: { num_predict: agent.maxTokens },
    tools: agent.tools.map(({ name, description, parameters }) => ({
      type: 'function',
      function: { name, description, parameters },
    })),
  });
  const message = record(value.message) ? value.message : {};
  const calls: ToolCall[] = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .filter(record)
    .map((call) => ({
      name: record(call.function) ? String(call.function.name ?? '') : '',
      args: record(call.function) ? parseArguments(call.function.arguments) : null,
    }));
  return { text: typeof message.content === 'string' ? message.content : '', calls };
}

export async function agentTurn(
  access: ProviderAccess,
  model: string,
  agent: AgentRequest,
): Promise<AgentTurn> {
  switch (access.provider) {
    case 'google':
      return googleTurn(access, model, agent);
    case 'openai':
    case 'mistral':
    case 'openrouter':
    case 'deepseek':
      return compatibleTurn(access, model, agent);
    case 'anthropic':
      return anthropicTurn(access, model, agent);
    case 'ollama-cloud':
    case 'ollama-local':
      return ollamaTurn(access, model, agent);
  }
}
