import { describe, expect, it } from 'vitest';
import type { MockLanguageModelV4 } from 'ai/test';
import { scripted } from '../helpers/scripted-model';
import {
  AGENT_MAX_TOOLS,
  AGENT_MAX_TURNS,
  runAssistant,
  type AssistantRun,
} from '../../src/main/services/assistant-runner';
import { StagingBuffer } from '../../src/main/services/agent-staging';

function run(model: MockLanguageModelV4, overrides: Partial<AssistantRun> = {}) {
  const texts: string[] = [];
  const statuses: string[] = [];
  const promise = runAssistant({
    model,
    system: 'system',
    messages: [{ role: 'user', content: 'Fix it' }],
    staging: new StagingBuffer('a\nb\n'),
    providerOptions: {},
    signal: new AbortController().signal,
    check: () => undefined,
    onText: (text) => texts.push(text),
    onStatus: (status) => statuses.push(status),
    ...overrides,
  });
  return { promise, texts, statuses };
}

describe('SDK assistant runner', () => {
  it('answers ordinary questions without tools or document access', async () => {
    const model = scripted([{ text: 'Use \\section.' }]);
    const { promise, texts } = run(model, { staging: undefined });
    await expect(promise).resolves.toMatchObject({ text: 'Use \\section.', staged: null });
    expect(texts.at(-1)).toBe('Use \\section.');
    expect(model.doStreamCalls[0].tools ?? []).toHaveLength(0);
    expect(model.doStreamCalls[0].maxOutputTokens).toBe(4096);
  });

  it('keeps provider reasoning separate from the user-visible answer', async () => {
    const model = scripted([{ reasoning: 'Check the requested syntax.', text: 'Use \\section.' }]);
    const reasoning: string[] = [];
    const { promise, texts } = run(model, {
      staging: undefined,
      onReasoning: (text) => reasoning.push(text),
    });
    await expect(promise).resolves.toMatchObject({ text: 'Use \\section.' });
    expect(texts.at(-1)).toBe('Use \\section.');
    expect(reasoning.at(-1)).toBe('Check the requested syntax.');
  });

  it('exposes pathless read, insert, replace, and delete tools when authorized', async () => {
    const model = scripted([{ text: 'No change needed.' }]);
    await run(model).promise;
    expect(model.doStreamCalls[0].tools?.map((tool) => tool.name).sort()).toEqual([
      'delete_range',
      'insert_text',
      'read_current_file',
      'replace_range',
    ]);
  });

  it('stages exact deletions through the delete tool', async () => {
    const model = scripted([
      { calls: [{ name: 'delete_range', input: { expected: 'a\n' } }] },
      { text: 'Removed the first line.' },
    ]);
    const { promise, statuses } = run(model);
    await expect(promise).resolves.toMatchObject({ staged: 'b\n' });
    expect(statuses).toEqual(['Staging a deletion']);
  });

  it('reads on demand, stages several edits in emitted order, and returns the staged text', async () => {
    const model = scripted([
      { calls: [{ name: 'read_current_file', input: {} }] },
      {
        calls: [
          { name: 'replace_range', input: { expected: 'a', text: 'A' } },
          { name: 'replace_range', input: { expected: 'A\nb', text: 'A\nB' } },
        ],
      },
      { text: 'Capitalized both lines.' },
    ]);
    const { promise, statuses } = run(model);
    const result = await promise;
    expect(result).toMatchObject({ staged: 'A\nB\n', text: 'Capitalized both lines.' });
    expect(statuses).toEqual([
      'Reading the active document',
      'Staging a replacement',
      'Staging a replacement',
    ]);
    // The tool transcript is replayed by the SDK, including results, on later steps.
    const third = JSON.stringify(model.doStreamCalls[2].prompt);
    expect(third).toContain('"staged":true');
  });

  it('returns recoverable edit errors to the model and lets it correct them', async () => {
    const model = scripted([
      { calls: [{ name: 'replace_range', input: { expected: 'missing', text: 'A' } }] },
      { calls: [{ name: 'replace_range', input: { expected: 'a', text: 'A' } }] },
      { text: 'Done.' },
    ]);
    const result = await run(model).promise;
    expect(result.staged).toBe('A\nb\n');
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('Expected text was not found.');
  });

  it('treats unknown arguments as fatal and discards staging', async () => {
    const model = scripted([
      { calls: [{ name: 'read_current_file', input: {} }] },
      { calls: [{ name: 'replace_range', input: { expected: 'a', text: 'A', path: '/x' } }] },
      { text: 'Done.' },
    ]);
    await expect(run(model).promise).rejects.toMatchObject({ code: 'AI_AGENT_ARGUMENT' });
  });

  it('enforces the tool budget across a run', async () => {
    const model = scripted([
      {
        calls: Array.from({ length: AGENT_MAX_TOOLS + 1 }, () => ({
          name: 'read_current_file',
          input: {},
        })),
      },
    ]);
    await expect(run(model).promise).rejects.toMatchObject({ code: 'AI_AGENT_LIMIT' });
  });

  it('enforces the response budget and discards unfinished tool loops', async () => {
    const model = scripted([{ calls: [{ name: 'read_current_file', input: {} }] }]);
    await expect(run(model).promise).rejects.toMatchObject({
      code: 'AI_AGENT_LIMIT',
      message: expect.stringContaining(`${AGENT_MAX_TURNS}-response`),
    });
    expect(model.doStreamCalls).toHaveLength(AGENT_MAX_TURNS);
  });

  it('discards a staged proposal when the final response was truncated', async () => {
    const model = scripted([
      { calls: [{ name: 'read_current_file', input: {} }] },
      { calls: [{ name: 'replace_range', input: { expected: 'a', text: 'A' } }] },
      { text: 'Partial', finish: 'length' },
    ]);
    await expect(run(model).promise).rejects.toMatchObject({ code: 'AI_AGENT_LIMIT' });
  });

  it('stops before the next operation when the captured document is invalidated', async () => {
    let valid = true;
    const model = scripted([
      { calls: [{ name: 'read_current_file', input: {} }] },
      { calls: [{ name: 'replace_range', input: { expected: 'a', text: 'A' } }] },
      { text: 'Done.' },
    ]);
    const stale = Object.assign(new Error('stale'), { code: 'AI_AGENT_STALE' });
    const { promise } = run(model, {
      check: () => {
        if (!valid) throw stale;
      },
      onStatus: () => {
        valid = false;
      },
    });
    await expect(promise).rejects.toBe(stale);
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it('fails cleanly when a run is cancelled', async () => {
    const controller = new AbortController();
    const model = scripted([{ calls: [{ name: 'read_current_file', input: {} }] }, { text: 'x' }]);
    const { promise } = run(model, {
      signal: controller.signal,
      onStatus: () => controller.abort(),
    });
    await expect(promise).rejects.toBeTruthy();
  });

  it('rejects an empty answer', async () => {
    const model = scripted([{ text: '' }]);
    await expect(run(model, { staging: undefined }).promise).rejects.toMatchObject({
      code: 'AI_EMPTY',
    });
  });

  it('bounds cumulative output', async () => {
    const model = scripted([{ text: 'x'.repeat(32_001) }]);
    await expect(run(model, { staging: undefined }).promise).rejects.toMatchObject({
      code: 'AI_AGENT_LIMIT',
    });
  });
});
