import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  completionGenerate,
  streamChat,
  type ProviderAccess,
} from '../../src/main/services/ai-providers';
import {
  guardedSDKFetch,
  ProviderHTTPError,
  resolveSDKModel,
  sdkProviderOptions,
} from '../../src/main/services/ai-sdk-runtime';
import { runAssistant } from '../../src/main/services/assistant-runner';
import { StagingBuffer } from '../../src/main/services/agent-staging';
import type { AIProviderId } from '../../src/shared/ai';

/**
 * Provider contracts: the real SDK adapters talk to a local fixture HTTP server that speaks
 * each provider's documented streaming format. No live provider or credential is used.
 */
interface Received {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown> | null;
}
type Handler = (request: Received, response: ServerResponse) => void | Promise<void>;
let server: Server;
let base = '';
let received: Received[] = [];
let handlers: Handler[] = [];
let closed = 0;

beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      const entry: Received = {
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null,
      };
      received.push(entry);
      response.on('close', () => closed++);
      const handler = handlers.shift();
      if (!handler) {
        response.writeHead(500).end('{"error":{"message":"unexpected request"}}');
        return;
      }
      void handler(entry, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  received = [];
  handlers = [];
  closed = 0;
});

function sse(events: unknown[], response: ServerResponse, done = true) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of events) {
    const value = event as { event?: string };
    if (value.event) response.write(`event: ${value.event}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  if (done) response.write('data: [DONE]\n\n');
  response.end();
}

const chatChunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
  id: 'chunk',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'fixture-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(finish ? { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } : {}),
});
const chatText =
  (text: string): Handler =>
  (_request, response) =>
    sse([chatChunk({ role: 'assistant', content: text }), chatChunk({}, 'stop')], response);
const anthropicEvents = (blocks: unknown[], stop = 'end_turn') => [
  {
    type: 'message_start',
    message: {
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'fixture-model',
      content: [],
      stop_reason: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  },
  ...blocks,
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 1 } },
  { type: 'message_stop' },
];
const anthropicText =
  (text: string): Handler =>
  (_request, response) =>
    sse(
      anthropicEvents([
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
      ]),
      response,
      false,
    );
const googleText =
  (text: string): Handler =>
  (_request, response) =>
    sse(
      [
        {
          candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        },
      ],
      response,
      false,
    );

function access(provider: AIProviderId, prefix = ''): ProviderAccess {
  return { provider, key: 'secret-key', endpoint: `${base}${prefix}` };
}
const chat = (signal = new AbortController().signal) => ({
  system: 'Be concise.',
  messages: [
    { role: 'user' as const, text: 'Why?' },
    { role: 'model' as const, text: 'Because.' },
    { role: 'user' as const, text: 'Fix it.' },
  ],
  maxTokens: 100,
  signal,
});

const CHAT_COMPLETIONS: AIProviderId[] = [
  'openai',
  'mistral',
  'codestral',
  'deepseek',
  'openrouter',
  'custom',
  'ollama-local',
  'ollama-cloud',
];

describe('SDK provider contracts', () => {
  it.each(CHAT_COMPLETIONS)('streams %s Chat Completions text with bearer auth', async (id) => {
    handlers.push(chatText('Hello'));
    const prefix = id.startsWith('ollama') ? '' : '/v1';
    const text = await streamChat(access(id, prefix), 'fixture-model', chat());
    expect(text).toBe('Hello');
    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/v1/chat/completions');
    expect(request.headers.authorization).toBe('Bearer secret-key');
    expect(request.body).toMatchObject({ model: 'fixture-model', stream: true });
    const messages = request.body?.messages as { role: string; content: unknown }[];
    expect(messages[0].role).toBe('system');
    expect(JSON.stringify(messages[0].content)).toContain('Be concise.');
    expect(messages.slice(1).map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('uses Chat Completions, not the Responses API, for OpenAI', async () => {
    handlers.push(chatText('OK'));
    await streamChat(access('openai', '/v1'), 'gpt-5-mini', chat());
    expect(received[0].path).toBe('/v1/chat/completions');
  });

  it('keeps OpenRouter explicit routing with provider fallback disabled', async () => {
    handlers.push(chatText('OK'));
    await streamChat(access('openrouter', '/api/v1'), 'openai/gpt-5-mini', chat());
    expect(received[0].path).toBe('/api/v1/chat/completions');
    expect(received[0].body).toMatchObject({
      model: 'openai/gpt-5-mini',
      provider: { require_parameters: true, allow_fallbacks: false },
    });
    expect(sdkProviderOptions(access('openai'))).toEqual({});
  });

  it('honors a configured custom path prefix and works without a key', async () => {
    handlers.push(chatText('OK'));
    await streamChat(
      { provider: 'custom', key: null, endpoint: `${base}/proxy/v1` },
      'local-model',
      chat(),
    );
    expect(received[0].path).toBe('/proxy/v1/chat/completions');
    expect(received[0].headers.authorization).toBeUndefined();
  });

  it('streams Anthropic Messages with a top-level system prompt and key header', async () => {
    handlers.push(anthropicText('Hi'));
    expect(await streamChat(access('anthropic', '/v1'), 'claude-fixture', chat())).toBe('Hi');
    expect(received[0].path).toBe('/v1/messages');
    expect(received[0].headers['x-api-key']).toBe('secret-key');
    expect(received[0].body?.system).toEqual([{ type: 'text', text: 'Be concise.' }]);
  });

  it('streams Gemini through the configured host with the key in a header', async () => {
    handlers.push(googleText('Hi'));
    expect(await streamChat(access('google'), 'gemini-fixture', chat())).toBe('Hi');
    expect(received[0].path).toBe('/v1beta/models/gemini-fixture:streamGenerateContent?alt=sse');
    expect(received[0].headers['x-goog-api-key']).toBe('secret-key');
    expect(received[0].body?.systemInstruction).toMatchObject({
      parts: [{ text: 'Be concise.' }],
    });
  });

  it('never retries: one failed request is one HTTP call, with a sanitized error', async () => {
    handlers.push((_request, response) => {
      response
        .writeHead(500, { 'content-type': 'application/json' })
        .end('{"error":{"message":"overloaded"}}');
    });
    await expect(streamChat(access('openai', '/v1'), 'm', chat())).rejects.toMatchObject({
      status: 500,
      detail: 'overloaded',
    });
    expect(received).toHaveLength(1);
  });

  it('reports authentication failures without echoing the key', async () => {
    handlers.push((_request, response) => {
      response
        .writeHead(401, { 'content-type': 'application/json' })
        .end('{"error":{"message":"bad key"}}');
    });
    const error = await streamChat(access('anthropic', '/v1'), 'm', chat()).catch((cause) => cause);
    expect(error).toBeInstanceOf(ProviderHTTPError);
    expect(error.status).toBe(401);
    expect(JSON.stringify(error)).not.toContain('secret-key');
    expect(received).toHaveLength(1);
  });

  it('refuses redirects instead of forwarding credentials', async () => {
    handlers.push((_request, response) => {
      response.writeHead(302, { location: 'https://example.invalid/steal' }).end();
    });
    await expect(streamChat(access('openai', '/v1'), 'm', chat())).rejects.toBeTruthy();
    expect(received).toHaveLength(1);
  });

  it('fails a malformed stream instead of hanging or returning partial data as success', async () => {
    handlers.push((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: {not json}\n\n');
    });
    await expect(streamChat(access('openai', '/v1'), 'm', chat())).rejects.toBeTruthy();
  });

  it('cancels an in-flight stream through the shared signal', async () => {
    const controller = new AbortController();
    handlers.push((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        `data: ${JSON.stringify(chatChunk({ role: 'assistant', content: 'Hel' }))}\n\n`,
      );
      // Never finishes on its own.
    });
    const pending = streamChat(access('openai', '/v1'), 'm', {
      ...chat(controller.signal),
      onText: () => controller.abort(),
    });
    await expect(pending).rejects.toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(1);
  });

  it('keeps chat-based completion on its small exact token budget', async () => {
    handlers.push(chatText('line 1\nline 2\nline 3'));
    const text = await completionGenerate(access('openai', '/v1'), 'm', {
      prefix: 'a',
      suffix: 'b',
      metadata: '',
      maxTokens: 128,
      maxLines: 2,
      signal: new AbortController().signal,
      transport: 'chat',
    });
    expect(text).toBe('line 1\nline 2');
    expect(received[0].body).toMatchObject({ max_tokens: 128 });
  });
});

describe('SDK tool replay through the assistant runner', () => {
  const runner = async (id: AIProviderId, prefix: string) =>
    runAssistant({
      model: await resolveSDKModel(access(id, prefix), 'fixture-model'),
      system: 'System.',
      messages: [{ role: 'user', content: 'Capitalize a.' }],
      staging: new StagingBuffer('a\n'),
      providerOptions: sdkProviderOptions(access(id, prefix)),
      signal: new AbortController().signal,
      check: () => undefined,
      onText: () => undefined,
      onStatus: () => undefined,
    });

  it('replays Chat Completions tool calls, results and DeepSeek reasoning', async () => {
    const call = (id: string, name: string, args: unknown) =>
      chatChunk({
        role: 'assistant',
        tool_calls: [
          { index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ],
      });
    handlers.push(
      (_request, response) =>
        sse(
          [
            chatChunk({ role: 'assistant', reasoning_content: 'Need the text.' }),
            call('c1', 'read_current_file', {}),
            chatChunk({}, 'tool_calls'),
          ],
          response,
        ),
      (_request, response) =>
        sse(
          [call('c2', 'replace_range', { expected: 'a', text: 'A' }), chatChunk({}, 'tool_calls')],
          response,
        ),
      chatText('Done.'),
    );
    const result = await runner('deepseek', '/v1');
    expect(result).toMatchObject({ staged: 'A\n', text: 'Done.' });
    expect(received).toHaveLength(3);
    expect(
      (received[0].body?.tools as { function: { name: string } }[]).map(
        (tool) => tool.function.name,
      ),
    ).toEqual(expect.arrayContaining(['read_current_file', 'insert_text', 'replace_range']));
    const replay = received[1].body?.messages as Record<string, unknown>[];
    const assistant = replay.find((message) => message.role === 'assistant');
    expect(assistant).toMatchObject({
      reasoning_content: 'Need the text.',
      tool_calls: [{ id: 'c1', function: { name: 'read_current_file' } }],
    });
    const tool = replay.find((message) => message.role === 'tool');
    expect(tool).toMatchObject({ tool_call_id: 'c1' });
    expect(String(tool?.content)).toContain('"text":"a\\n"');
  });

  it('replays Anthropic thinking signatures with tool_use and tool_result blocks', async () => {
    handlers.push(
      (_request, response) =>
        sse(
          anthropicEvents(
            [
              {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'thinking', thinking: '', signature: '' },
              },
              {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'thinking_delta', thinking: 'Read first.' },
              },
              {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'signature_delta', signature: 'sig-123' },
              },
              { type: 'content_block_stop', index: 0 },
              {
                type: 'content_block_start',
                index: 1,
                content_block: {
                  type: 'tool_use',
                  id: 'tu1',
                  name: 'read_current_file',
                  input: {},
                },
              },
              {
                type: 'content_block_delta',
                index: 1,
                delta: { type: 'input_json_delta', partial_json: '{}' },
              },
              { type: 'content_block_stop', index: 1 },
            ],
            'tool_use',
          ),
          response,
          false,
        ),
      anthropicText('Nothing to change.'),
    );
    const result = await runner('anthropic', '/v1');
    expect(result).toMatchObject({ staged: null, text: 'Nothing to change.' });
    const replay = received[1].body?.messages as {
      role: string;
      content: Record<string, unknown>[];
    }[];
    const assistant = replay.find((message) => message.role === 'assistant');
    expect(assistant?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'thinking', signature: 'sig-123' }),
        expect.objectContaining({ type: 'tool_use', id: 'tu1', name: 'read_current_file' }),
      ]),
    );
    const results = replay.at(-1)?.content;
    expect(results?.[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1' });
  });
});

describe('guarded fetch', () => {
  const ok = async () => new Response('{}');
  it('pins requests to the configured origin and path prefix', async () => {
    const guarded = guardedSDKFetch('https://api.example.com/v1', undefined, ok);
    await expect(guarded('https://api.example.com/v1/chat/completions')).resolves.toBeTruthy();
    await expect(guarded('https://evil.example.com/v1/chat')).rejects.toMatchObject({
      status: 400,
    });
    await expect(guarded('https://api.example.com/v2/chat')).rejects.toMatchObject({
      status: 400,
    });
    await expect(guarded('https://user:pw@api.example.com/v1/x')).rejects.toMatchObject({
      status: 400,
    });
  });
  it('requests no redirect following and joins the shared cancellation signal', async () => {
    const shared = new AbortController();
    let init: RequestInit | undefined;
    const guarded = guardedSDKFetch(
      'https://api.example.com',
      shared.signal,
      async (_input, value) => {
        init = value;
        return new Response('{}');
      },
    );
    await guarded('https://api.example.com/x', { method: 'POST' });
    expect(init?.redirect).toBe('error');
    shared.abort();
    expect(init?.signal?.aborted).toBe(true);
  });
  it('rejects a redirect response', async () => {
    const guarded = guardedSDKFetch(
      'https://api.example.com',
      undefined,
      async () => new Response(null, { status: 307, headers: { location: 'https://x.invalid' } }),
    );
    await expect(guarded('https://api.example.com/x')).rejects.toMatchObject({ status: 502 });
  });
  it('requires a key for hosted providers before any request', async () => {
    await expect(
      resolveSDKModel({ provider: 'openai', key: null }, 'gpt-5-mini'),
    ).rejects.toMatchObject({ status: 401 });
  });
});
