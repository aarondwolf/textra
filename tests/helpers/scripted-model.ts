import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';

/** A step is either assistant text or a batch of tool calls emitted together. */
export type Step = {
  text?: string;
  reasoning?: string;
  calls?: { name: string; input: unknown }[];
  finish?: string;
};

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** Scripted SDK language model: each doStream call plays the next step; the last repeats. */
export function scripted(steps: Step[]) {
  let index = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const step = steps[Math.min(index++, steps.length - 1)];
      const parts: unknown[] = [{ type: 'stream-start', warnings: [] }];
      if (step.text) {
        parts.push({ type: 'text-start', id: 't' });
        parts.push({ type: 'text-delta', id: 't', delta: step.text });
        parts.push({ type: 'text-end', id: 't' });
      }
      if (step.reasoning) {
        parts.push({ type: 'reasoning-start', id: 'r' });
        parts.push({ type: 'reasoning-delta', id: 'r', delta: step.reasoning });
        parts.push({ type: 'reasoning-end', id: 'r' });
      }
      for (const [n, call] of (step.calls ?? []).entries())
        parts.push({
          type: 'tool-call',
          toolCallId: `call-${index}-${n}`,
          toolName: call.name,
          input: JSON.stringify(call.input),
        });
      parts.push({
        type: 'finish',
        finishReason: {
          unified: step.finish ?? (step.calls?.length ? 'tool-calls' : 'stop'),
          raw: undefined,
        },
        usage,
      });
      return { stream: convertArrayToReadableStream(parts as never[]) };
    },
  });
  return model;
}
