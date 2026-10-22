import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completionGenerate,
  listModels,
  type ProviderAccess,
} from '../../src/main/services/ai-providers';

// Provider HTTP is stubbed; these tests pin model discovery and the native FIM wire formats.
// Generation through the AI SDK is covered by tests/integration/ai-sdk-providers.test.ts.
interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown> | null;
  redirect: string;
}
function stubFetch(...responses: Response[]): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const text = await request.text();
      sent.push({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
        redirect: init?.redirect ?? 'follow',
      });
      const next = responses.shift();
      if (!next) throw new Error('Unexpected request');
      return next;
    }),
  );
  return sent;
}
const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const streamResponse = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
  );
const signal = new AbortController().signal;
const access = (provider: ProviderAccess['provider'], key: string | null = 'secret-key') => ({
  provider,
  key,
  ...(provider === 'custom' ? { endpoint: 'http://127.0.0.1:8000/v1' } : {}),
});
afterEach(() => vi.unstubAllGlobals());

describe('model listing', () => {
  it('uses a configured custom catalogue endpoint without requiring a key', async () => {
    const sent = stubFetch(jsonResponse({ data: [{ id: 'my-model', name: 'My model' }] }));
    expect(
      await listModels(
        { provider: 'custom', key: null, endpoint: 'http://127.0.0.1:8000/v1' },
        signal,
      ),
    ).toEqual([{ id: 'my-model', label: 'My model' }]);
    expect(sent[0].url).toBe('http://127.0.0.1:8000/v1/models');
    expect(sent[0].headers.get('authorization')).toBeNull();
    expect(sent[0].redirect).toBe('error');
  });
  it('lists Codestral chat and FIM-only models from its dedicated service', async () => {
    const sent = stubFetch(
      jsonResponse({
        data: [
          { id: 'codestral-latest', capabilities: { completion_chat: true } },
          { id: 'codestral-2508' },
          { id: 'codestral-fim-only', capabilities: { completion_chat: false } },
          { id: 'mistral-small-latest', capabilities: { completion_chat: true } },
        ],
      }),
    );
    expect((await listModels(access('codestral'), signal)).map(({ id }) => id)).toEqual([
      'codestral-2508',
      'codestral-fim-only',
      'codestral-latest',
    ]);
    expect(sent[0].url).toBe('https://codestral.mistral.ai/v1/models');
    expect(sent[0].headers.get('authorization')).toBe('Bearer secret-key');
    expect(sent[0].redirect).toBe('error');
  });
  it('uses the authenticated OpenRouter catalogue and text-output metadata', async () => {
    const sent = stubFetch(
      jsonResponse({
        data: [
          {
            id: 'anthropic/claude-sonnet',
            name: 'Claude Sonnet',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
          },
          { id: 'vendor/generator', architecture: { output_modalities: ['image'] } },
          { id: 'vendor/mixed', architecture: { output_modalities: ['text', 'image'] } },
          { id: 'vendor/unknown' },
          { id: 'openrouter/auto', architecture: { output_modalities: ['text'] } },
          { id: 'openrouter/free', architecture: { output_modalities: ['text'] } },
        ],
      }),
    );
    expect(await listModels(access('openrouter'), signal)).toEqual([
      { id: 'anthropic/claude-sonnet', label: 'Claude Sonnet' },
    ]);
    expect(sent[0].url).toBe('https://openrouter.ai/api/v1/models/user?output_modalities=text');
    expect(sent[0].headers.get('authorization')).toBe('Bearer secret-key');
    expect(sent[0].redirect).toBe('error');
  });
  it('does not accept an OpenRouter key based on the public catalogue', async () => {
    const sent = stubFetch(jsonResponse({ error: { message: 'Invalid key' } }, 401));
    await expect(listModels(access('openrouter'), signal)).rejects.toMatchObject({ status: 401 });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain('/models/user');
  });
  it('lists Gemini chat models with the key in a header', async () => {
    const sent = stubFetch(
      jsonResponse({
        models: [
          {
            name: 'models/gemini-3.5-flash-lite',
            displayName: 'Gemini 3.5 Flash Lite',
            supportedGenerationMethods: ['generateContent'],
          },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/imagen-4', supportedGenerationMethods: ['generateContent'] },
          {
            name: 'models/gemini-voice-only',
            supportedGenerationMethods: ['generateContent'],
            outputModalities: ['AUDIO'],
          },
          {
            name: 'models/gemini-text',
            supportedGenerationMethods: ['generateContent'],
            outputModalities: ['TEXT'],
          },
        ],
      }),
    );
    expect(await listModels(access('google'), signal)).toEqual([
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
      { id: 'gemini-text', label: 'gemini-text' },
    ]);
    expect(sent[0].url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    );
    expect(sent[0].headers.get('x-goog-api-key')).toBe('secret-key');
    expect(sent[0].url).not.toContain('secret-key');
    expect(sent[0].redirect).toBe('error');
  });
  it('lists OpenAI chat models and drops audio, image and embedding models', async () => {
    const sent = stubFetch(
      jsonResponse({
        data: [
          { id: 'gpt-5-mini' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' },
          { id: 'gpt-image-1' },
          { id: 'gpt-5' },
          { id: 'unrelated-service' },
          { id: 'gpt-5-pro' },
          { id: 'gpt-5-codex' },
        ],
      }),
    );
    expect((await listModels(access('openai'), signal)).map(({ id }) => id)).toEqual([
      'gpt-5',
      'gpt-5-mini',
    ]);
    expect(sent[0].url).toBe('https://api.openai.com/v1/models');
    expect(sent[0].headers.get('authorization')).toBe('Bearer secret-key');
  });
  it('lists Anthropic models with display names and version header', async () => {
    const sent = stubFetch(
      jsonResponse({ data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }] }),
    );
    expect(await listModels(access('anthropic'), signal)).toEqual([
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ]);
    expect(sent[0].url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(sent[0].headers.get('x-api-key')).toBe('secret-key');
    expect(sent[0].headers.get('anthropic-version')).toBe('2023-06-01');
  });
  it('lists Ollama Cloud and local tags from their fixed hosts', async () => {
    const sent = stubFetch(
      jsonResponse({ models: [{ name: 'gpt-oss:120b', model: 'gpt-oss:120b' }] }),
      jsonResponse({ capabilities: ['completion', 'tools'] }),
      jsonResponse({ models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest' }] }),
      jsonResponse({ capabilities: ['completion'] }),
    );
    expect(await listModels(access('ollama-cloud'), signal)).toEqual([
      { id: 'gpt-oss:120b', label: 'gpt-oss:120b' },
    ]);
    expect(await listModels(access('ollama-local', null), signal)).toEqual([
      { id: 'llama3.2:latest', label: 'llama3.2' },
    ]);
    expect(sent[0].url).toBe('https://ollama.com/api/tags');
    expect(sent[0].headers.get('authorization')).toBe('Bearer secret-key');
    expect(sent[1].url).toBe('https://ollama.com/api/show');
    expect(sent[1].body).toEqual({ model: 'gpt-oss:120b' });
    expect(sent[2].url).toBe('http://127.0.0.1:11434/api/tags');
    expect(sent[2].headers.get('authorization')).toBeNull();
  });
  it('filters Ollama embeddings including custom names by capability', async () => {
    stubFetch(
      jsonResponse({ models: [{ name: 'my-custom-model' }, { name: 'nomic-embed-text' }] }),
      jsonResponse({ capabilities: ['embedding'] }),
    );
    expect(await listModels(access('ollama-local', null), signal)).toEqual([]);
  });
  it('uses the name fallback when an Ollama server lacks the metadata endpoint', async () => {
    stubFetch(
      jsonResponse({ models: [{ name: 'llama3.2' }, { name: 'embeddinggemma' }] }),
      jsonResponse({}, 404),
    );
    expect(await listModels(access('ollama-cloud'), signal)).toEqual([
      { id: 'llama3.2', label: 'llama3.2' },
    ]);
  });
  it('lists Mistral chat and FIM models and DeepSeek text-output models', async () => {
    const sent = stubFetch(
      jsonResponse({
        data: [
          { id: 'mistral-small-latest', capabilities: { completion_chat: true } },
          { id: 'codestral-latest', capabilities: { completion_chat: false } },
          { id: 'mistral-embed', capabilities: { completion_chat: false } },
          { id: 'mistral-ocr-latest', capabilities: { completion_chat: false } },
        ],
      }),
      jsonResponse({
        data: [
          { id: 'deepseek-chat', name: 'DeepSeek Chat', output_modalities: ['text'] },
          { id: 'deepseek-reasoner' },
          { id: 'deepseek-future', output_modalities: ['audio'] },
        ],
      }),
    );
    expect(await listModels(access('mistral'), signal)).toEqual([
      {
        id: 'codestral-latest',
        label: 'codestral-latest',
        capabilities: { chat: false, completion: true, transport: 'mistral-fim' },
      },
      { id: 'mistral-small-latest', label: 'mistral-small-latest' },
    ]);
    expect(await listModels(access('deepseek'), signal)).toEqual([
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner' },
    ]);
    expect(sent.map(({ url }) => url)).toEqual([
      'https://api.mistral.ai/v1/models',
      'https://api.deepseek.com/models',
    ]);
    expect(
      sent.every(
        ({ headers, redirect }) =>
          headers.get('authorization') === 'Bearer secret-key' && redirect === 'error',
      ),
    ).toBe(true);
  });
  it('surfaces HTTP status and the provider message', async () => {
    stubFetch(jsonResponse({ error: { message: 'Incorrect API key' } }, 401));
    await expect(listModels(access('openai'), signal)).rejects.toMatchObject({
      status: 401,
      detail: 'Incorrect API key',
    });
  });
});

describe('insertion completion adapters', () => {
  const request = {
    prefix: 'before\\n',
    suffix: '\\nfollowing',
    metadata: 'language=latex',
    maxTokens: 128,
    signal,
    transport: 'chat' as const,
  };
  it.each(['mistral', 'codestral'] as const)(
    'uses %s FIM without wrapping literal context',
    async (provider) => {
      const sent = stubFetch(jsonResponse({ choices: [{ message: { content: 'insert' } }] }));
      expect(
        await completionGenerate(access(provider, `${provider}-key`), 'codestral-latest', {
          ...request,
          transport: 'mistral-fim',
        }),
      ).toBe('insert');
      expect(sent).toHaveLength(1);
      expect(sent[0].url).toBe(
        provider === 'mistral'
          ? 'https://api.mistral.ai/v1/fim/completions'
          : 'https://codestral.mistral.ai/v1/fim/completions',
      );
      expect(sent[0].headers.get('authorization')).toBe(`Bearer ${provider}-key`);
      expect(sent[0].body).toEqual({
        model: 'codestral-latest',
        prompt: request.prefix,
        suffix: request.suffix,
        max_tokens: 128,
        stream: false,
      });
    },
  );
  it('discovers verified Qwen FIM templates and leaves unverified models on chat', async () => {
    stubFetch(
      jsonResponse({ models: [{ name: 'qwen2.5-coder:3b' }, { name: 'custom:latest' }] }),
      jsonResponse({
        capabilities: ['completion'],
        template:
          '{{ if .Suffix }}<|fim_prefix|>{{ .Prompt }}<|fim_suffix|>{{ .Suffix }}<|fim_middle|>{{ else }}<|im_start|>{{ .Prompt }}{{ end }}',
      }),
      jsonResponse({ capabilities: ['completion'], template: '{{ .Prompt }}{{ .Suffix }}' }),
    );
    expect(await listModels(access('ollama-local', null), signal)).toEqual([
      { id: 'custom:latest', label: 'custom' },
      {
        id: 'qwen2.5-coder:3b',
        label: 'qwen2.5-coder:3b',
        capabilities: { chat: true, completion: true, transport: 'ollama-generate' },
      },
    ]);
  });
  it('uses native Ollama suffix generation and warms only the requested model', async () => {
    const sent = stubFetch(
      streamResponse(['{"response":"hello"}\n', '{"response":" world","done":true}\n']),
    );
    expect(
      await completionGenerate(access('ollama-local', null), 'qwen2.5-coder:3b', {
        ...request,
        transport: 'ollama-generate',
      }),
    ).toBe('hello world');
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('http://127.0.0.1:11434/api/generate');
    expect(sent[0].body).toEqual({
      model: 'qwen2.5-coder:3b',
      prompt: request.prefix,
      suffix: request.suffix,
      stream: true,
      options: { num_predict: 128 },
      keep_alive: '5m',
    });
  });
  it('ends local generation at an echoed suffix before explanation or EOS', async () => {
    stubFetch(
      streamResponse([
        '{"response":"a + b\\n\\\\end{lst"}\n',
        '{"response":"listing}\\nUnwanted explanation"}\n',
      ]),
    );
    expect(
      await completionGenerate(access('ollama-local', null), 'qwen2.5-coder:3b', {
        ...request,
        suffix: '\n\\end{lstlisting}\n\\end{document}',
        transport: 'ollama-generate',
      }),
    ).toBe('a + b');
  });
  it('preserves several automatic local lines instead of stopping after the first', async () => {
    stubFetch(streamResponse(['{"response":"one\\ntwo\\nthree\\nfour"}\n']));
    expect(
      await completionGenerate(access('ollama-local', null), 'qwen2.5-coder:3b', {
        ...request,
        transport: 'ollama-generate',
      }),
    ).toBe('one\ntwo\nthree\nfour');
  });
  it('preserves a leading newline and indentation across multiple useful local lines', async () => {
    stubFetch(streamResponse(['{"response":"\\n"}\n', '{"response":"  a + b\\n  + c"}\n']));
    expect(
      await completionGenerate(access('ollama-local', null), 'qwen2.5-coder:3b', {
        ...request,
        transport: 'ollama-generate',
      }),
    ).toBe('\n  a + b\n  + c');
  });
  it('stops automatic local generation at ten lines without waiting for EOS and preserves CRLF', async () => {
    const cancel = vi.fn();
    const output = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\r\n');
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ response: output })}\n`));
        },
        cancel,
      }),
    );
    const sent = stubFetch(response);
    expect(
      await completionGenerate(access('ollama-local', null), 'qwen2.5-coder:0.5b', {
        ...request,
        maxTokens: 384,
        maxLines: 10,
        transport: 'ollama-generate',
      }),
    ).toBe(output.split('\r\n').slice(0, 10).join('\r\n'));
    expect(sent[0].body?.options).toEqual({ num_predict: 384 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('allows twenty manual local lines with an explicit line budget', async () => {
    const output = Array.from({ length: 21 }, (_, index) => `line ${index + 1}`).join('\n');
    stubFetch(streamResponse([`${JSON.stringify({ response: output })}\n`]));
    expect(
      await completionGenerate(access('ollama-local', null), 'qwen2.5-coder:0.5b', {
        ...request,
        maxTokens: 512,
        maxLines: 20,
        transport: 'ollama-generate',
      }),
    ).toBe(output.split('\n').slice(0, 20).join('\n'));
  });
  it('preserves CRLF split across streamed response chunks', async () => {
    stubFetch(
      streamResponse([
        `${JSON.stringify({ response: 'first\r' })}\n`,
        `${JSON.stringify({ response: '\nsecond\r\nthird', done: true })}\n`,
      ]),
    );
    expect(
      await completionGenerate(access('ollama-local', null), 'qwen2.5-coder:0.5b', {
        ...request,
        maxLines: 10,
        transport: 'ollama-generate',
      }),
    ).toBe('first\r\nsecond\r\nthird');
  });
  it('never falls back after authentication failure', async () => {
    const sent = stubFetch(jsonResponse({ error: 'No quota' }, 429));
    await expect(
      completionGenerate(access('codestral'), 'codestral-latest', {
        ...request,
        transport: 'mistral-fim',
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(sent).toHaveLength(1);
  });
  it('rejects a native transport belonging to another provider before networking', async () => {
    const sent = stubFetch();
    await expect(
      completionGenerate(access('google'), 'gemini-flash', {
        ...request,
        transport: 'mistral-fim',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(sent).toHaveLength(0);
  });
});
