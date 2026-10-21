import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Content, Part } from '@google/genai';
import { BoundedAgentService, type AgentGenerate } from '../../src/main/services/agent';
import { AIService, type KeyCipher } from '../../src/main/services/ai-service';
import {
  fromGoogleContent,
  toGoogleContents,
  type AgentTurn,
} from '../../src/main/services/ai-providers';
import { agentEditHunks } from '../../src/shared/ai-edits';
const GOOGLE_MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 31B' },
];
const DEFAULT_AGENT_MODEL = { provider: 'google', model: 'gemini-3.5-flash-lite' } as const;
const cipher: KeyCipher = {
  available: () => true,
  encrypt: (key) => Buffer.from(key),
  decrypt: (key) => key.toString(),
};
// Injected identity cipher is a fixture only; production uses OS-account encryption.
const document = {
  projectId: 'project-1',
  path: 'chapters/main.tex',
  revision: 'revision-1',
  content: 'Hello world.',
};
const tool = (name: string, args: Record<string, unknown> = {}): Part => ({
  functionCall: { name, args },
});
const response = (...parts: Part[]): AgentTurn => fromGoogleContent({ role: 'model', parts });

describe('bounded active-document agent staging', () => {
  let directory: string;
  let gemini: AIService;
  let request: ReturnType<typeof vi.fn<AgentGenerate>>;
  let agent: BoundedAgentService;
  let contextId: string;
  const run = (overrides: Record<string, unknown> = {}) =>
    agent.run({
      contextId,
      prompt: 'Fix the greeting.',
      model: DEFAULT_AGENT_MODEL,
      requestId: 'request-1',
      ...overrides,
    });
  const sent = (call: number): Content[] => toGoogleContents(request.mock.calls[call][2].items);
  beforeEach(async () => {
    const root = join(process.cwd(), 'test-results', 'agent');
    await mkdir(root, { recursive: true });
    directory = await mkdtemp(join(root, 'case-'));
    gemini = new AIService(directory, cipher, { list: async () => GOOGLE_MODELS });
    await gemini.saveProvider({ provider: 'google', apiKey: 'test-secret' });
    request = vi.fn<AgentGenerate>().mockResolvedValue(response({ text: 'No change needed.' }));
    agent = new BoundedAgentService(gemini, request);
    contextId = agent.syncDocument(document)!.contextId;
  });
  afterEach(async () => {
    agent.cancel();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  it('stages exact UTF-16 insertions and replacements, preserves signed content, and never writes files', async () => {
    const signed = tool('read_current_file');
    signed.thoughtSignature = 'opaque-signature';
    const first = response(signed);
    request
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(
        response(
          tool('replace_range', { start: 6, end: 11, expected: 'world', text: 'LaTeX' }),
          tool('insert_text', { offset: 12, text: '\n' }),
        ),
      )
      .mockResolvedValueOnce(response({ text: 'Fixed the greeting.' }));
    const result = await run();
    expect(result.proposal).toMatchObject({ ...document, modified: 'Hello LaTeX.\n', contextId });
    expect(sent(1)[1]).toBe(first.raw);
    expect(await readdir(directory)).toEqual(['ai.json']);
    expect(agent.getDocument(contextId)).toEqual(document);
    const accepted = agent.accept({ id: result.proposal!.id, contextId });
    expect(accepted.modified).toBe('Hello LaTeX.\n');
    expect(agent.getDocument(contextId).content).toBe(document.content);
    expect(() => agent.accept({ id: accepted.id, contextId })).toThrow();
  });
  it('uses the selected Google model and no proposal for pure explanation', async () => {
    expect(
      (await run({ model: { provider: 'google', model: 'gemma-4-31b-it' } })).proposal,
    ).toBeNull();
    expect(request.mock.calls[0][1]).toBe('gemma-4-31b-it');
    expect(sent(0)).toEqual([{ role: 'user', parts: [{ text: 'Fix the greeting.' }] }]);
  });
  it('refuses a model that is not in the provider list before calling it', async () => {
    await expect(run({ model: { provider: 'google', model: 'not-listed' } })).rejects.toMatchObject(
      { code: 'AI_MODEL_UNAVAILABLE' },
    );
    await expect(run({ model: { provider: 'openai', model: 'gpt-5-mini' } })).rejects.toMatchObject(
      { code: 'AI_KEY_REQUIRED' },
    );
    expect(request).not.toHaveBeenCalled();
  });
  it.each([undefined, null])(
    'accepts an omitted/null zero-argument read and inserts using Unicode columns: %j',
    async (args) => {
      contextId = agent.syncDocument({ ...document, content: 'One\r\n😀 two\r\n' })!.contextId;
      request
        .mockResolvedValueOnce(
          response({
            functionCall: {
              name: 'read_current_file',
              ...(args === undefined ? {} : { args: args as unknown as Record<string, unknown> }),
            },
          }),
        )
        .mockResolvedValueOnce(
          response(tool('insert_text', { line: 2, column: 2, text: ' lorem ipsum' })),
        )
        .mockResolvedValueOnce(response({ text: 'Proposed the insertion.' }));
      const result = await run();
      expect(result.proposal?.modified).toBe('One\r\n😀 lorem ipsum two\r\n');
      expect(sent(1)[2].parts?.[0].functionResponse?.response).toMatchObject({
        lines: [
          { line: 1, offset: 0, text: 'One', endColumn: 4 },
          { line: 2, offset: 5, text: '😀 two', endColumn: 6 },
          { line: 3, offset: 13, text: '', endColumn: 1 },
        ],
      });
    },
  );
  it('corrects a safe mismatch and finishes naturally within the bounded run', async () => {
    request
      .mockResolvedValueOnce(response(tool('read_current_file')))
      .mockResolvedValueOnce(
        response(tool('replace_range', { expected: 'Wrong expected text', text: 'LaTeX' })),
      )
      .mockResolvedValueOnce(response(tool('replace_range', { expected: 'world', text: 'LaTeX' })));
    expect((await run()).proposal?.modified).toBe('Hello LaTeX.');
    expect(request).toHaveBeenCalledTimes(4);
    expect(sent(2)[4].parts?.[0].functionResponse?.response).toMatchObject({
      error: { recoverable: true },
    });
  });
  it('returns precise column bounds so an invalid insertion can be corrected', async () => {
    request
      .mockResolvedValueOnce(response(tool('read_current_file')))
      .mockResolvedValueOnce(
        response(tool('insert_text', { line: 1, column: 14, text: ' Added.' })),
      )
      .mockResolvedValueOnce(
        response(tool('insert_text', { line: 1, column: 13, text: ' Added.' })),
      )
      .mockResolvedValueOnce(response({ text: 'Staged the insertion for review.' }));
    expect((await run()).proposal?.modified).toBe('Hello world. Added.');
    expect(sent(2)[4].parts?.[0].functionResponse?.response).toMatchObject({
      staged: false,
      error: { message: expect.stringContaining('Line 1 allows columns 1 through 13.') },
    });
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('asks the model to disambiguate repeated expected text', async () => {
    contextId = agent.syncDocument({ ...document, content: 'same same' })!.contextId;
    request.mockResolvedValueOnce(
      response(tool('read_current_file'), tool('replace_range', { expected: 'same', text: 'new' })),
    );
    expect((await run()).proposal).toBeNull();
    expect(JSON.stringify(sent(1))).toContain('ambiguous');
  });
  it('includes bounded prior chat and appends the latest instruction once', async () => {
    const messages = [
      { role: 'user', text: 'Why is the command missing?' },
      { role: 'model', text: 'Add the package.' },
    ];
    await run({ messages, prompt: 'Apply that package fix.' });
    expect(sent(0)).toEqual([
      ...messages.map(({ role, text }) => ({ role, parts: [{ text }] })),
      { role: 'user', parts: [{ text: 'Apply that package fix.' }] },
    ]);
    request.mockClear();
    await run({
      messages: [...messages, { role: 'user', text: 'Apply that package fix.' }],
      prompt: 'Apply that package fix.',
    });
    expect(sent(0)).toHaveLength(3);
  });
  it.each([
    null,
    [{ role: 'system', text: 'hidden' }],
    [{ role: 'user', text: 'a'.repeat(32_001) }],
    Array.from({ length: 41 }, (_, i) => ({ role: i % 2 ? 'model' : 'user', text: 'x' })),
    ['user', 'model', 'user'].map((role) => ({ role, text: 'a'.repeat(22_000) })),
  ])('rejects invalid or oversized history before Google: %#', async (messages) => {
    await expect(run({ messages })).rejects.toMatchObject({ code: 'AI_AGENT_ARGUMENT' });
    expect(request).not.toHaveBeenCalled();
  });
  it('applies only named review hunks and never includes a skipped change', async () => {
    const content = 'first\nunchanged\nlast\n';
    contextId = agent.syncDocument({ ...document, content })!.contextId;
    request.mockResolvedValueOnce(
      response(
        tool('read_current_file'),
        tool('replace_range', { expected: 'first', text: 'FIRST' }),
        tool('replace_range', { expected: 'last', text: 'LAST' }),
      ),
    );
    const proposal = (await run()).proposal!;
    const hunks = agentEditHunks(content, proposal.modified);
    expect(hunks).toHaveLength(2);
    for (const hunkIds of [[], ['unknown'], [hunks[0].id, hunks[0].id], [1]])
      expect(() => agent.accept({ id: proposal.id, contextId, hunkIds })).toThrow();
    expect(agent.accept({ id: proposal.id, contextId, hunkIds: [hunks[0].id] }).modified).toBe(
      'FIRST\nunchanged\nlast\n',
    );
    expect(() => agent.accept({ id: proposal.id, contextId })).toThrow();
  });
  it.each([
    null,
    {},
    { ...document, path: '../main.tex' },
    { ...document, path: '/main.tex' },
    { ...document, path: 'C:/main.tex' },
    { ...document, path: 'main.txt' },
    { ...document, path: 'dir\\main.tex' },
    { ...document, path: 'dir//main.tex' },
    { ...document, content: 'a'.repeat(64_001) },
    { ...document, revision: 1 },
  ])('invalid or non-tex scope revokes the previous document: %#', (value) => {
    expect(agent.syncDocument(value)).toBeNull();
    expect(() => agent.getDocument(contextId)).toThrow();
  });
  it.each([
    { model: 'unknown-google-model' },
    { model: '../evil' },
    { prompt: '' },
    { prompt: 'a'.repeat(12_001) },
    { requestId: '../bad' },
    { contextId: 3 },
    { command: 'delete' },
  ])('rejects untrusted request fields before Google: %#', async (override) => {
    await expect(run(override)).rejects.toMatchObject({ code: 'AI_AGENT_ARGUMENT' });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    tool('read_file', { path: 'other.tex' }),
    tool('delete_file'),
    tool('shell', { command: 'echo' }),
    tool('read_current_file', { path: 'main.tex' }),
    tool('insert_text', { offset: 0, text: 'x', path: 'other.tex' }),
  ])('rejects invalid tools and edits, with no proposal: %#', async (part) => {
    request.mockResolvedValueOnce(response(tool('read_current_file'), part));
    await expect(run()).rejects.toMatchObject({ code: 'AI_AGENT_ARGUMENT' });
    expect(await readdir(directory)).toEqual(['ai.json']);
  });
  it.each([
    tool('replace_range', { start: 0, end: 5, expected: 'WRONG', text: 'new' }),
    tool('replace_range', { start: 0, end: 5, expected: 'Hello', text: '' }),
    tool('replace_range', { start: 0, end: 5, expected: 'Hello', text: 'Hello' }),
    tool('replace_range', { start: 0, end: 0, expected: '', text: 'x' }),
    tool('insert_text', { offset: -1, text: 'x' }),
    tool('insert_text', { offset: 99, text: 'x' }),
    tool('insert_text', { offset: 1.5, text: 'x' }),
    tool('insert_text', { offset: '1', text: 'x' }),
    tool('insert_text', { offset: 0, text: '' }),
  ])('returns safe invalid operations as bounded correctable tool errors: %#', async (part) => {
    request.mockResolvedValueOnce(response(tool('read_current_file'), part));
    expect((await run()).proposal).toBeNull();
    expect(sent(1).at(-1)?.parts?.at(-1)?.functionResponse?.response).toMatchObject({
      staged: false,
      error: { code: 'INVALID_TEXT_OPERATION', recoverable: true },
    });
  });
  it('requires reading before editing', async () => {
    request.mockResolvedValueOnce(response(tool('insert_text', { offset: 0, text: 'x' })));
    expect((await run()).proposal).toBeNull();
    expect(sent(1).at(-1)?.parts?.[0].functionResponse?.response).toMatchObject({
      error: { recoverable: true },
    });
  });
  it('rejects ranges splitting UTF-16 surrogate pairs', async () => {
    contextId = agent.syncDocument({ ...document, content: 'a😀b' })!.contextId;
    request.mockResolvedValueOnce(
      response(tool('read_current_file'), tool('insert_text', { offset: 2, text: 'x' })),
    );
    expect((await run()).proposal).toBeNull();
  });
  it('verifies staged edits with another read before the final response', async () => {
    request
      .mockResolvedValueOnce(response(tool('read_current_file')))
      .mockResolvedValueOnce(
        response(tool('insert_text', { line: 1, column: 1, text: 'Lorem ipsum. ' })),
      )
      .mockResolvedValueOnce(response(tool('read_current_file')));
    const result = await run();
    expect(result.proposal?.modified).toBe('Lorem ipsum. Hello world.');
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('stages both a package insertion and body replacement before verification and summary', async () => {
    const content = '\\documentclass{article}\n\\begin{document}\nOld body.\n\\end{document}\n';
    contextId = agent.syncDocument({ ...document, content })!.contextId;
    request
      .mockResolvedValueOnce(
        response({ text: 'First I will inspect the file.' }, tool('read_current_file')),
      )
      .mockResolvedValueOnce(
        response(tool('insert_text', { line: 2, column: 1, text: '\\usepackage{lipsum}\n' })),
      )
      .mockResolvedValueOnce(
        response(tool('replace_range', { expected: 'Old body.', text: '\\lipsum[1]' })),
      )
      .mockResolvedValueOnce(response(tool('read_current_file')))
      .mockResolvedValueOnce(response({ text: 'Added lipsum and replaced the body.' }));
    const result = await run({
      prompt: 'Add lipsum and replace the old body with its first paragraph.',
    });
    const proposal = result.proposal!;
    expect(result.text).toBe('Added lipsum and replaced the body.');
    expect(proposal.modified).toBe(
      '\\documentclass{article}\n\\usepackage{lipsum}\n\\begin{document}\n\\lipsum[1]\n\\end{document}\n',
    );
    expect(agentEditHunks(content, proposal.modified)).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(5);
    expect(sent(4).at(-1)?.parts?.[0].functionResponse?.response).toMatchObject({
      text: proposal.modified,
    });
  });
  it('discards partial staged work when the model never finishes within six calls', async () => {
    request
      .mockResolvedValueOnce(response(tool('read_current_file')))
      .mockResolvedValue(response(tool('insert_text', { offset: 0, text: 'partial ' })));
    await expect(run()).rejects.toMatchObject({ code: 'AI_AGENT_LIMIT' });
    expect(request).toHaveBeenCalledTimes(6);
    expect(agent.getDocument(contextId)).toEqual(document);
    expect(() => agent.accept({ id: 'anything', contextId })).toThrow();
  });
  it('reviews consecutive decisions, rebases pending hunks, and consumes each proposal id', async () => {
    const content = 'one\nanchor-a\ntwo\nanchor-b\nthree\n';
    contextId = agent.syncDocument({ ...document, content })!.contextId;
    request.mockResolvedValueOnce(
      response(
        tool('read_current_file'),
        tool('replace_range', { expected: 'one', text: 'ONE' }),
        tool('replace_range', { expected: 'two', text: 'TWO' }),
        tool('replace_range', { expected: 'three', text: 'THREE' }),
      ),
    );
    const first = (await run()).proposal!;
    const firstId = agentEditHunks(first.content, first.modified)[0].id;
    const review = agent.review({
      id: first.id,
      contextId,
      approveHunkIds: [firstId],
      rejectHunkIds: [],
    });
    expect(review.applied?.modified).toBe('ONE\nanchor-a\ntwo\nanchor-b\nthree\n');
    expect(review.context.contextId).not.toBe(contextId);
    expect(review.remaining?.id).not.toBe(first.id);
    expect(review.remaining?.content).toBe(review.applied?.modified);
    expect(agent.syncDocument(agent.getDocument(review.context.contextId))).toEqual(review.context);
    expect(() =>
      agent.review({ id: first.id, contextId, approveHunkIds: [firstId], rejectHunkIds: [] }),
    ).toThrow();
    const second = review.remaining!;
    const secondId = agentEditHunks(second.content, second.modified)[0].id;
    const reject = agent.review({
      id: second.id,
      contextId: second.contextId,
      approveHunkIds: [],
      rejectHunkIds: [secondId],
    });
    expect(reject.applied).toBeNull();
    expect(reject.context).toEqual(review.context);
    expect(reject.remaining?.modified).toBe('ONE\nanchor-a\ntwo\nanchor-b\nTHREE\n');
    const last = reject.remaining!;
    const final = agent.review({
      id: last.id,
      contextId: last.contextId,
      approveHunkIds: agentEditHunks(last.content, last.modified).map(({ id }) => id),
      rejectHunkIds: [],
    });
    expect(final.remaining).toBeNull();
    expect(final.applied?.modified).toBe('ONE\nanchor-a\ntwo\nanchor-b\nTHREE\n');
    expect(agent.getDocument(final.context.contextId).content).toBe(final.applied?.modified);
    expect(() => agent.accept({ id: last.id, contextId: final.context.contextId })).toThrow();
  });
  it('validates review decisions and handles simultaneous approval and rejection', async () => {
    contextId = agent.syncDocument({ ...document, content: 'one\nanchor\ntwo\n' })!.contextId;
    request.mockResolvedValueOnce(
      response(
        tool('read_current_file'),
        tool('replace_range', { expected: 'one', text: 'ONE' }),
        tool('replace_range', { expected: 'two', text: 'TWO' }),
      ),
    );
    const proposal = (await run()).proposal!;
    const ids = agentEditHunks(proposal.content, proposal.modified).map(({ id }) => id);
    const valid = { id: proposal.id, contextId, approveHunkIds: [ids[0]], rejectHunkIds: [ids[1]] };
    for (const override of [
      { approveHunkIds: [], rejectHunkIds: [] },
      { approveHunkIds: [ids[0], ids[0]] },
      { rejectHunkIds: [ids[0]] },
      { approveHunkIds: ['unknown'] },
      { rejectHunkIds: [1] },
      { text: 'arbitrary' },
    ])
      expect(() => agent.review({ ...valid, ...override })).toThrow();
    const result = agent.review(valid);
    expect(result.applied?.modified).toBe('ONE\nanchor\ntwo\n');
    expect(result.remaining).toBeNull();
  });
  it.each(['repeat-read', 'tool-loop', 'output', 'source'])(
    'enforces the %s budget without retries',
    async (kind) => {
      if (kind === 'repeat-read') request.mockResolvedValue(response(tool('read_current_file')));
      if (kind === 'tool-loop')
        request.mockResolvedValueOnce(
          response(
            tool('read_current_file'),
            ...Array.from({ length: 12 }, () => tool('insert_text', { offset: 0, text: 'x' })),
          ),
        );
      if (kind === 'output') request.mockResolvedValueOnce(response({ text: 'a'.repeat(32_001) }));
      if (kind === 'source')
        request.mockResolvedValueOnce(
          response(
            tool('read_current_file'),
            tool('insert_text', { offset: 0, text: 'a'.repeat(64_000) }),
          ),
        );
      await expect(run()).rejects.toMatchObject({ code: 'AI_AGENT_LIMIT' });
      expect(request.mock.calls.length).toBeLessThanOrEqual(6);
    },
  );
  it('keeps an identical snapshot but expires proposals after switching away and back', async () => {
    expect(agent.syncDocument({ ...document })!.contextId).toBe(contextId);
    request.mockResolvedValueOnce(
      response(tool('read_current_file'), tool('insert_text', { offset: 0, text: 'x' })),
    );
    const result = await run();
    agent.reject('wrong-id');
    expect(agent.getDocument(contextId)).toEqual(document);
    agent.syncDocument(null);
    expect(agent.syncDocument(document)!.contextId).not.toBe(contextId);
    expect(() => agent.accept({ id: result.proposal!.id, contextId })).toThrow();
  });
  it('reject clears only the matching proposal and accept never permits replay', async () => {
    request.mockResolvedValueOnce(
      response(tool('read_current_file'), tool('insert_text', { offset: 0, text: 'x' })),
    );
    const result = await run();
    agent.reject(result.proposal!.id);
    expect(() => agent.accept({ id: result.proposal!.id, contextId })).toThrow();
  });
  it('invalidates inflight work even when switching away then back', async () => {
    let finish!: (value: AgentTurn) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    request.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pending = run();
    await ready;
    await expect(run()).rejects.toMatchObject({ code: 'AI_BUSY' });
    await expect(gemini.removeProvider({ provider: 'google' })).rejects.toMatchObject({
      code: 'AI_BUSY',
    });
    agent.syncDocument(null);
    agent.syncDocument(document);
    finish(response({ text: 'Old response.' }));
    await expect(pending).rejects.toMatchObject({ code: 'AI_AGENT_STALE' });
  });
  it.each([429, 401, 404, 500])('sanitizes provider HTTP %i without retrying', async (status) => {
    request.mockRejectedValueOnce(
      Object.assign(new Error('secret test-secret provider details'), { status }),
    );
    const error = await run().catch((error: unknown) => error);
    expect(String(error)).not.toContain('test-secret');
    if (status === 429) expect(error).toMatchObject({ code: 'AI_RATE_LIMIT' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(GOOGLE_MODELS)(
    'routes $id through the real SDK with only three pathless tools',
    async ({ id: model }) => {
      const sent: Request[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (input, init) => {
          sent.push(new Request(input, init));
          return new Response(
            JSON.stringify({ candidates: [{ content: response({ text: 'Looks good.' }).raw }] }),
            { headers: { 'content-type': 'application/json' } },
          );
        }),
      );
      const sdk = new BoundedAgentService(gemini);
      const context = sdk.syncDocument(document)!;
      await sdk.run({
        contextId: context.contextId,
        prompt: 'Check this.',
        model: { provider: 'google', model },
        requestId: 'sdk-1',
      });
      expect(sent).toHaveLength(1);
      expect(sent[0].url).toBe(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      );
      const body = (await sent[0].json()) as {
        tools: { functionDeclarations: { name: string; parametersJsonSchema: object }[] }[];
      };
      expect(body.tools[0].functionDeclarations.map(({ name }) => name)).toEqual([
        'read_current_file',
        'insert_text',
        'replace_range',
      ]);
      expect(JSON.stringify(body.tools)).not.toContain('path');
      expect(JSON.stringify(body)).not.toContain(document.path);
    },
  );
  it('handles real SDK omitted read arguments followed by a lorem ipsum line insertion', async () => {
    const bodies: { contents: Content[] }[] = [];
    const replies = [
      response({ functionCall: { name: 'read_current_file' }, thoughtSignature: 'read-signature' }),
      response(tool('insert_text', { line: 2, column: 1, text: 'Lorem ipsum dolor sit amet.\n' })),
      response({ text: 'Proposed a lorem ipsum paragraph.' }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        bodies.push((await new Request(input, init).json()) as { contents: Content[] });
        return new Response(
          JSON.stringify({ candidates: [{ content: replies[bodies.length - 1].raw }] }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const sdk = new BoundedAgentService(gemini);
    const content = '\\begin{document}\n\\end{document}\n';
    const context = sdk.syncDocument({ ...document, content })!;
    const result = await sdk.run({
      contextId: context.contextId,
      prompt: 'Add a lorem ipsum paragraph.',
      model: { provider: 'google', model: 'gemma-4-26b-a4b-it' },
      requestId: 'sdk-insert',
    });
    expect(result.proposal?.modified).toBe(
      '\\begin{document}\nLorem ipsum dolor sit amet.\n\\end{document}\n',
    );
    expect(bodies).toHaveLength(3);
    expect(bodies[1].contents[1].parts?.[0].thoughtSignature).toBe('read-signature');
    expect(bodies[1].contents[2].parts?.[0].functionResponse?.response).toMatchObject({
      lines: [
        { line: 1, offset: 0, text: '\\begin{document}' },
        { line: 2, offset: 17, text: '\\end{document}' },
        { line: 3, offset: 32, text: '' },
      ],
    });
  });
});
