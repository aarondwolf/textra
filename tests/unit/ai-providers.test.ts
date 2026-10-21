import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  agentTurn,
  completionGenerate,
  COMPLETION_SYSTEM_PROMPT,
  listModels,
  streamChat,
  type AgentItem,
  type ProviderAccess,
  type ToolSpec,
} from '../../src/main/services/ai-providers';
import { CHAT_SYSTEM_PROMPT } from '../../src/main/services/ai-service';
import { AI_PROVIDER_IDS } from '../../src/shared/ai';

// Provider HTTP is stubbed; these tests pin each provider's wire format.
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
const tools: ToolSpec[] = [
  {
    name: 'read_current_file',
    description: 'Read.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];
const access = (provider: ProviderAccess['provider'], key: string | null = 'secret-key') => ({
  provider,
  key,
});
const chat = {
  system: 'Be concise.',
  messages: [
    { role: 'user' as const, text: 'Why?' },
    { role: 'model' as const, text: 'Because.' },
    { role: 'user' as const, text: 'Fix it.' },
  ],
  maxTokens: 100,
  signal,
};

afterEach(() => vi.unstubAllGlobals());

describe('model listing', () => {
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

describe('streamed chat formats', () => {
  it.each(AI_PROVIDER_IDS)(
    'preserves the shared system instructions on the %s wire',
    async (provider) => {
      const event =
        provider === 'google'
          ? { candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] } }] }
          : provider === 'anthropic'
            ? { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } }
            : { choices: [{ delta: { content: 'OK' } }] };
      const ollama = provider.startsWith('ollama-');
      const sent = stubFetch(
        new Response(
          ollama
            ? '{"message":{"content":"OK"},"done":true}\n'
            : `data: ${JSON.stringify(event)}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
      expect(
        await streamChat(access(provider), 'fixture-model', {
          ...chat,
          system: CHAT_SYSTEM_PROMPT,
        }),
      ).toBe('OK');
      const body = sent[0].body!;
      const wireSystem =
        provider === 'google'
          ? (body.systemInstruction as { parts: { text: string }[] }).parts[0].text
          : provider === 'anthropic'
            ? body.system
            : (body.messages as { content: string }[])[0].content;
      expect(wireSystem).toBe(CHAT_SYSTEM_PROMPT);
      expect(sent[0].redirect).toBe('error');
      if (provider === 'mistral' || provider === 'codestral' || provider === 'deepseek') {
        expect(body.max_tokens).toBe(chat.maxTokens);
        expect(body).not.toHaveProperty('max_completion_tokens');
        expect(sent[0].url).toBe(
          provider === 'mistral'
            ? 'https://api.mistral.ai/v1/chat/completions'
            : provider === 'codestral'
              ? 'https://codestral.mistral.ai/v1/chat/completions'
              : 'https://api.deepseek.com/chat/completions',
        );
      }
      if (provider === 'openrouter') {
        expect(sent[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(body).toMatchObject({
          max_tokens: chat.maxTokens,
          modalities: ['text'],
          provider: { require_parameters: true, allow_fallbacks: false },
        });
      }
    },
  );
  it('streams OpenAI Chat Completions server-sent events', async () => {
    const sent = stubFetch(
      streamResponse([
        'data: {"choices":[{"delta":{"content":"Use "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\\\usepackage."}}]}\n\ndata: [DONE]\n\n',
      ]),
    );
    const partials: string[] = [];
    const text = await streamChat(access('openai'), 'gpt-5-mini', {
      ...chat,
      onText: (value) => partials.push(value),
    });
    expect(text).toBe('Use \\usepackage.');
    expect(partials).toEqual(['Use ', 'Use \\usepackage.']);
    expect(sent[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(sent[0].body).toMatchObject({
      model: 'gpt-5-mini',
      stream: true,
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Why?' },
        { role: 'assistant', content: 'Because.' },
        { role: 'user', content: 'Fix it.' },
      ],
    });
  });
  it('streams Anthropic Messages text deltas with a top-level system prompt', async () => {
    const sent = stubFetch(
      streamResponse([
        'event: message_start\ndata: {"type":"message_start"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Add "}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"amsmath."}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    );
    expect(await streamChat(access('anthropic'), 'claude-haiku-5-5', chat)).toBe('Add amsmath.');
    expect(sent[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0].body).toMatchObject({
      system: 'Be concise.',
      max_tokens: 100,
      stream: true,
      messages: [
        { role: 'user', content: 'Why?' },
        { role: 'assistant', content: 'Because.' },
        { role: 'user', content: 'Fix it.' },
      ],
    });
  });
  it('turns Anthropic stream errors into provider errors', async () => {
    stubFetch(
      streamResponse([
        'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
      ]),
    );
    await expect(streamChat(access('anthropic'), 'claude-haiku-5-5', chat)).rejects.toMatchObject({
      status: 529,
    });
  });
  it('streams Ollama NDJSON from the local server', async () => {
    const sent = stubFetch(
      streamResponse([
        '{"message":{"role":"assistant","content":"Close "},"done":false}\n{"message":{"role":"assistant","content":"the brace."},"done":false}\n',
        '{"message":{"role":"assistant","content":""},"done":true}\n',
      ]),
    );
    expect(await streamChat(access('ollama-local', null), 'llama3.2:latest', chat)).toBe(
      'Close the brace.',
    );
    expect(sent[0].url).toBe('http://127.0.0.1:11434/api/chat');
    expect(sent[0].body).toMatchObject({
      model: 'llama3.2:latest',
      stream: true,
      options: { num_predict: 100 },
      messages: [{ role: 'system', content: 'Be concise.' }, {}, { role: 'assistant' }, {}],
    });
  });
});

describe('agent tool-calling formats', () => {
  const items: AgentItem[] = [
    { role: 'user', text: 'Fix it.' },
    { role: 'assistant', text: '', calls: [{ id: 'call_1', name: 'read_current_file', args: {} }] },
    { role: 'tool', results: [{ id: 'call_1', name: 'read_current_file', result: { text: 'x' } }] },
  ];
  const request = { system: 'Edit.', items, tools, maxTokens: 100, signal };
  it('preserves OpenRouter reasoning blocks and requires tool-capable routing', async () => {
    const reasoning_details = [
      { type: 'reasoning.encrypted', data: 'opaque', signature: 'sig', index: 0 },
    ];
    const sent = stubFetch(
      jsonResponse({
        choices: [
          {
            message: {
              content: '',
              reasoning_details,
              tool_calls: [
                {
                  id: 'read1',
                  type: 'function',
                  function: { name: 'read_current_file', arguments: '{}' },
                },
              ],
            },
          },
        ],
      }),
      jsonResponse({ choices: [{ message: { content: 'Done.' } }] }),
    );
    const turn = await agentTurn(access('openrouter'), 'anthropic/claude-sonnet', request);
    await agentTurn(access('openrouter'), 'anthropic/claude-sonnet', {
      ...request,
      items: [
        { role: 'user', text: 'Fix it.' },
        { role: 'assistant', text: turn.text, calls: turn.calls, raw: turn.raw },
        {
          role: 'tool',
          results: [{ id: 'read1', name: 'read_current_file', result: { text: 'x' } }],
        },
      ],
    });
    expect((sent[1].body!.messages as Record<string, unknown>[])[2].reasoning_details).toEqual(
      reasoning_details,
    );
    expect(sent[0].body).toMatchObject({
      provider: { require_parameters: true, allow_fallbacks: false },
      tools: [{ type: 'function' }],
    });
    expect(sent[0].body).not.toHaveProperty('models');
  });

  it.each(['mistral', 'codestral', 'deepseek'] as const)(
    'routes %s tools and preserves DeepSeek reasoning for replay',
    async (provider) => {
      const message = {
        content: '',
        reasoning_content: 'opaque-provider-metadata',
        tool_calls: [
          {
            id: 'abc123def',
            type: 'function',
            function: { name: 'read_current_file', arguments: '{}' },
          },
        ],
      };
      const sent = stubFetch(
        jsonResponse({ choices: [{ message }] }),
        jsonResponse({ choices: [{ message: { content: 'Done.' } }] }),
      );
      const turn = await agentTurn(access(provider), 'fixture-model', request);
      await agentTurn(access(provider), 'fixture-model', {
        ...request,
        items: [
          { role: 'user', text: 'Fix it.' },
          { role: 'assistant', text: turn.text, calls: turn.calls, raw: turn.raw },
          {
            role: 'tool',
            results: [{ id: 'abc123def', name: 'read_current_file', result: { text: 'x' } }],
          },
        ],
      });
      expect(turn.calls).toEqual([{ id: 'abc123def', name: 'read_current_file', args: {} }]);
      expect(sent[0].body).toMatchObject({ max_tokens: 100, tools: [{ type: 'function' }] });
      const replay = (sent[1].body!.messages as Record<string, unknown>[])[2];
      if (provider === 'deepseek') expect(replay.reasoning_content).toBe(message.reasoning_content);
      else expect(replay).not.toHaveProperty('reasoning_content');
    },
  );

  it('uses OpenAI function tools and parses JSON arguments', async () => {
    const sent = stubFetch(
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_2',
                  type: 'function',
                  function: { name: 'replace_range', arguments: '{"expected":"x","text":"y"}' },
                },
              ],
            },
          },
        ],
      }),
    );
    expect(await agentTurn(access('openai'), 'gpt-5-mini', request)).toEqual({
      text: '',
      calls: [{ id: 'call_2', name: 'replace_range', args: { expected: 'x', text: 'y' } }],
    });
    expect(sent[0].body).toMatchObject({
      tools: [{ type: 'function', function: { name: 'read_current_file' } }],
      messages: [
        { role: 'system', content: 'Edit.' },
        { role: 'user', content: 'Fix it.' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'read_current_file', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"text":"x"}' },
      ],
    });
  });
  it('uses Anthropic tool_use blocks and replays raw content with tool_result', async () => {
    const blocks = [
      { type: 'text', text: 'Reading.' },
      { type: 'tool_use', id: 'toolu_1', name: 'read_current_file', input: {} },
    ];
    const sent = stubFetch(jsonResponse({ content: blocks, stop_reason: 'tool_use' }));
    const turn = await agentTurn(access('anthropic'), 'claude-haiku-5-5', {
      ...request,
      items: [{ role: 'user', text: 'Fix it.' }],
    });
    expect(turn).toEqual({
      text: 'Reading.',
      calls: [{ id: 'toolu_1', name: 'read_current_file', args: {} }],
      raw: blocks,
    });
    expect(sent[0].body).toMatchObject({
      system: 'Edit.',
      tools: [{ name: 'read_current_file', input_schema: { type: 'object' } }],
    });
    const replay = stubFetch(jsonResponse({ content: [{ type: 'text', text: 'Done.' }] }));
    await agentTurn(access('anthropic'), 'claude-haiku-5-5', {
      ...request,
      items: [
        { role: 'user', text: 'Fix it.' },
        { role: 'assistant', text: turn.text, calls: turn.calls, raw: turn.raw },
        { role: 'tool', results: [{ id: 'toolu_1', name: 'read_current_file', result: { a: 1 } }] },
      ],
    });
    expect(replay[0].body?.messages).toEqual([
      { role: 'user', content: 'Fix it.' },
      { role: 'assistant', content: blocks },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"a":1}' }],
      },
    ]);
  });
  it('uses Ollama native tool calls with object arguments and tool_name results', async () => {
    const sent = stubFetch(
      jsonResponse({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'insert_text', arguments: { offset: 0, text: 'a' } } }],
        },
      }),
    );
    expect(await agentTurn(access('ollama-cloud'), 'gpt-oss:120b', request)).toEqual({
      text: '',
      calls: [{ name: 'insert_text', args: { offset: 0, text: 'a' } }],
    });
    expect(sent[0].url).toBe('https://ollama.com/api/chat');
    expect(sent[0].body).toMatchObject({
      stream: false,
      tools: [{ type: 'function', function: { name: 'read_current_file' } }],
      messages: [
        { role: 'system' },
        { role: 'user' },
        {
          role: 'assistant',
          tool_calls: [{ function: { name: 'read_current_file', arguments: {} } }],
        },
        { role: 'tool', tool_name: 'read_current_file', content: '{"text":"x"}' },
      ],
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
  it.each(AI_PROVIDER_IDS)(
    'uses identical completion instructions and small budgets on %s chat',
    async (provider) => {
      const event =
        provider === 'google'
          ? { candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] } }] }
          : provider === 'anthropic'
            ? { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } }
            : { choices: [{ delta: { content: 'OK' } }] };
      const sent = stubFetch(
        new Response(
          provider.startsWith('ollama-')
            ? '{"message":{"content":"OK"},"done":true}\n'
            : `data: ${JSON.stringify(event)}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
      expect(await completionGenerate(access(provider), 'fixture-model', request)).toBe('OK');
      const body = sent[0].body!;
      const system =
        provider === 'google'
          ? (body.systemInstruction as { parts: { text: string }[] }).parts[0].text
          : provider === 'anthropic'
            ? body.system
            : (body.messages as { content: string }[])[0].content;
      expect(system).toBe(COMPLETION_SYSTEM_PROMPT);
      if (provider === 'openai') expect(body.max_completion_tokens).toBe(128);
      if (provider === 'google')
        expect(body.generationConfig).toMatchObject({ maxOutputTokens: 128 });
      expect(sent).toHaveLength(1);
    },
  );
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
