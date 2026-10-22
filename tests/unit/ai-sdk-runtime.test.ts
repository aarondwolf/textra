import { describe, expect, it } from 'vitest';
import {
  ProviderHTTPError,
  sanitizedSDKError,
  sdkProviderOptions,
} from '../../src/main/services/ai-sdk-runtime';

describe('AI SDK runtime', () => {
  it('uses minimal Gemini thinking for Chat and low thinking for Agent on Flash-Lite', () => {
    const access = { provider: 'google' as const, key: 'test-key' };
    expect(sdkProviderOptions(access, 'gemini-3.5-flash-lite', 'chat')).toMatchObject({
      google: { thinkingConfig: { thinkingLevel: 'minimal', includeThoughts: true } },
    });
    expect(sdkProviderOptions(access, 'gemini-3.5-flash-lite', 'agent')).toMatchObject({
      google: { thinkingConfig: { thinkingLevel: 'low', includeThoughts: true } },
    });
    expect(sdkProviderOptions(access, 'gemini-2.5-flash', 'chat')).toMatchObject({
      google: { thinkingConfig: { includeThoughts: true } },
    });
  });

  it('converts SDK HTTP errors without exposing the request payload', () => {
    const error = sanitizedSDKError({
      name: 'AI_APICallError',
      statusCode: 503,
      responseBody: JSON.stringify({
        error: { message: 'This model is currently experiencing high demand.' },
      }),
      requestBodyValues: { contents: [{ parts: [{ text: 'private user text' }] }] },
    });
    expect(error).toBeInstanceOf(ProviderHTTPError);
    expect(error).toMatchObject({
      status: 503,
      detail: 'This model is currently experiencing high demand.',
    });
    expect(error.message).not.toContain('private user text');
  });
});
