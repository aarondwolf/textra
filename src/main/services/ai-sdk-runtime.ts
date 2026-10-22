import type { LanguageModel, streamText } from 'ai';
import type { ProviderAccess } from './ai-providers';
import { validateAIEndpoint } from './ai-endpoints';
import { AI_DEFAULT_ENDPOINTS } from '../../shared/ai';

/**
 * Main-process model factory for the Vercel AI SDK. Provider packages load lazily, only for a
 * connection that is receiving a real request. No gateway, hosted backend, environment keys or
 * singleton clients are used: every model is built from TeXtra's own encrypted configuration.
 */
export class ProviderHTTPError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`Provider returned HTTP ${status}`);
  }
}

export type SDKProviderOptions = NonNullable<Parameters<typeof streamText>[0]['providerOptions']>;

/** SDK retries are always disabled; TeXtra owns deadlines and user-visible retry. */
export const SDK_MAX_RETRIES = 0;

export function sdkBaseURL(access: ProviderAccess): string {
  if (access.endpoint) return validateAIEndpoint(access.endpoint);
  if (access.provider === 'custom')
    throw new ProviderHTTPError(400, 'Configure the custom provider base URL.');
  return AI_DEFAULT_ENDPOINTS[access.provider];
}

function requestURL(input: Parameters<typeof fetch>[0]): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return new URL(input.href);
  return new URL(input.url);
}

/**
 * Pins every SDK request to the configured origin and path prefix, refuses redirects, and joins
 * the request's own signal with the shared foreground cancellation signal.
 */
export function guardedSDKFetch(
  baseURL: string,
  shared?: AbortSignal,
  transport: typeof fetch = fetch,
): typeof fetch {
  const base = new URL(validateAIEndpoint(baseURL));
  const path = base.pathname.replace(/\/$/, '');
  return async (input, init) => {
    const target = requestURL(input);
    if (
      target.origin !== base.origin ||
      target.username ||
      target.password ||
      (path && target.pathname !== path && !target.pathname.startsWith(`${path}/`))
    )
      throw new ProviderHTTPError(400, 'The provider requested an invalid destination.');
    const signals = [init?.signal, shared].filter((signal): signal is AbortSignal =>
      Boolean(signal),
    );
    const response = await transport(input, {
      ...init,
      redirect: 'error',
      ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
    });
    // A fetch implementation must never silently route credentials through a redirect.
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderHTTPError(502, 'Provider redirects are not allowed.');
    }
    return response;
  };
}

/** Provider-specific latency and routing settings, without changing other models' defaults. */
export function sdkProviderOptions(
  access: ProviderAccess,
  model?: string,
  mode: 'chat' | 'agent' = 'agent',
): SDKProviderOptions {
  const options: Record<string, unknown> = {};
  if (access.provider === 'openrouter')
    options.openrouter = {
      provider: { require_parameters: true, allow_fallbacks: false },
      modalities: ['text'],
    };
  // Gemini 3.5 Flash-Lite supports minimal and low thinking levels. Use minimal for
  // ordinary Chat turns and low for explicit Agent work; older/other model defaults stay intact.
  if (access.provider === 'google' && /^gemini-(?:2\.5|3(?:\.|$))/i.test(model ?? '')) {
    const thinkingConfig: Record<string, unknown> = { includeThoughts: true };
    if (/^gemini-3\.5-flash-lite(?:-latest)?$/i.test(model ?? ''))
      thinkingConfig.thinkingLevel = mode === 'chat' ? 'minimal' : 'low';
    options.google = { thinkingConfig };
  }
  return options as SDKProviderOptions;
}

export interface SDKModelOptions {
  /** Shared foreground cancellation, joined into every provider HTTP request. */
  signal?: AbortSignal;
  /** Test seam for the guarded transport. */
  fetch?: typeof fetch;
}

/** Builds a language model directly from a configured connection. */
export async function resolveSDKModel(
  access: ProviderAccess,
  model: string,
  options: SDKModelOptions = {},
): Promise<LanguageModel> {
  const base = sdkBaseURL(access);
  const apiKey = access.key ?? undefined;
  if (!apiKey && !['custom', 'ollama-local'].includes(access.provider))
    throw new ProviderHTTPError(401, 'An API key is required.');
  const settings = {
    apiKey,
    baseURL: base,
    fetch: guardedSDKFetch(base, options.signal, options.fetch),
  };
  switch (access.provider) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      // Chat Completions explicitly; the Responses API is not used initially.
      return createOpenAI(settings).chat(model);
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      return createGoogleGenerativeAI({ ...settings, baseURL: `${base}/v1beta` })(model);
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return createAnthropic(settings)(model);
    }
    case 'mistral':
    case 'codestral': {
      const { createMistral } = await import('@ai-sdk/mistral');
      return createMistral(settings)(model);
    }
    case 'deepseek': {
      const { createDeepSeek } = await import('@ai-sdk/deepseek');
      return createDeepSeek(settings)(model);
    }
    case 'openrouter': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
      return createOpenRouter(settings)(model);
    }
    case 'custom':
    case 'ollama-local':
    case 'ollama-cloud': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      return createOpenAICompatible({
        ...settings,
        name: access.provider,
        // Ollama exposes its compatible API under /v1; custom endpoints are used as configured.
        baseURL: access.provider === 'custom' ? base : `${base}/v1`,
      })(model);
    }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Finds a provider-safe message in a JSON error body, without echoing the request. */
function providerMessage(body: unknown): string {
  if (typeof body !== 'string' || !body.trim()) return '';
  try {
    const value: unknown = JSON.parse(body);
    const candidate = record(value)
      ? record(value.error)
        ? value.error.message
        : typeof value.error === 'string'
          ? value.error
          : value.message
      : undefined;
    return typeof candidate === 'string' ? candidate.replace(/\s+/g, ' ').slice(0, 240) : '';
  } catch {
    return '';
  }
}

/**
 * Maps SDK failures to TeXtra's error vocabulary without exposing request bodies, URLs or
 * credentials. Network failures without an HTTP status stay plain errors so callers can
 * report connectivity rather than a provider rejection.
 */
export function sanitizedSDKError(error: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted)
    return signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Aborted', 'AbortError');
  for (let cause = error, depth = 0; cause && depth < 6; depth++) {
    if (cause instanceof ProviderHTTPError) return cause;
    cause = record(cause) || cause instanceof Error ? (cause as { cause?: unknown }).cause : null;
  }
  if (record(error) || error instanceof Error) {
    const value = error as Record<string, unknown>;
    const status = typeof value.statusCode === 'number' ? value.statusCode : undefined;
    if (status !== undefined)
      return new ProviderHTTPError(status, providerMessage(value.responseBody));
    if (value.name === 'AbortError') return new DOMException('Aborted', 'AbortError');
    if (
      typeof value.name === 'string' &&
      /AI_(InvalidResponseData|JSONParse|TypeValidation|EmptyResponseBody|NoContentGenerated)/.test(
        value.name,
      )
    )
      return new ProviderHTTPError(502, 'The provider returned a malformed response.');
  }
  return new Error('The provider could not be reached.');
}
