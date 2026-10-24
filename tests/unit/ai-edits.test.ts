import { describe, expect, it } from 'vitest';
import { agentEditHunks, applyAgentHunks } from '../../src/shared/ai-edits';
describe('bounded agent review hunks', () => {
  it('separates edits around unchanged lines and applies only approved complete hunks', () => {
    const original = 'first\nkeep\nlast\n';
    const modified = 'FIRST\nkeep\nLAST\n';
    const hunks = agentEditHunks(original, modified);
    expect(hunks).toHaveLength(2);
    expect(applyAgentHunks(original, hunks, [hunks[0].id])).toBe('FIRST\nkeep\nlast\n');
    expect(
      applyAgentHunks(
        original,
        hunks,
        hunks.map((h) => h.id),
      ),
    ).toBe(modified);
    expect(() => applyAgentHunks(original, hunks, ['arbitrary'])).toThrow();
    expect(() => applyAgentHunks(original, hunks, [hunks[0].id, hunks[0].id])).toThrow();
  });
  it.each([
    ['', 'new'],
    ['a', ''],
    ['a\n', 'a\nnew\n'],
    ['a\r\nb\r\n', 'a\r\nB\r\n'],
    ['😀x', '😀y'],
    ['a\nb', 'x\ny'],
  ])('round trips %j to %j', (before, after) => {
    const hunks = agentEditHunks(before, after);
    expect(
      applyAgentHunks(
        before,
        hunks,
        hunks.map((h) => h.id),
      ),
    ).toBe(after);
  });
  it('bounds large comparisons to one coherent review hunk', () => {
    const before = 'old\n'.repeat(3000);
    const after = 'new\n'.repeat(3000);
    const hunks = agentEditHunks(before, after);
    expect(hunks).toHaveLength(1);
    expect(applyAgentHunks(before, hunks, [hunks[0].id])).toBe(after);
  });
  it('preserves separate hunks even when changes are separated by many lines', () => {
    const filler = 'unchanged line\n'.repeat(200);
    const before = `first\n${filler}second\n`;
    const modified = `FIRST\n${filler}SECOND\n`;
    const hunks = agentEditHunks(before, modified);
    expect(hunks).toHaveLength(2);
    expect(applyAgentHunks(before, hunks, [hunks[0].id])).toBe(`FIRST\n${filler}second\n`);
  });
  it('finds no changes in identical documents', () =>
    expect(agentEditHunks('same', 'same')).toEqual([]));
});
