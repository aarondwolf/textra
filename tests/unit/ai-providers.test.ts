import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  agentTurn,
  listModels,
  streamChat,
  type AgentItem,
  type ProviderAccess,
  type ToolSpec,
} from '../../src/main/services/ai-providers';

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
        ],
      }),
    );
    expect(await listModels(access('google'), signal)).toEqual([
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
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
      jsonResponse({ models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest' }] }),
    );
    expect(await listModels(access('ollama-cloud'), signal)).toEqual([
      { id: 'gpt-oss:120b', label: 'gpt-oss:120b' },
    ]);
    expect(await listModels(access('ollama-local', null), signal)).toEqual([
      { id: 'llama3.2:latest', label: 'llama3.2' },
    ]);
    expect(sent[0].url).toBe('https://ollama.com/api/tags');
    expect(sent[0].headers.get('authorization')).toBe('Bearer secret-key');
    expect(sent[1].url).toBe('http://127.0.0.1:11434/api/tags');
    expect(sent[1].headers.get('authorization')).toBeNull();
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
