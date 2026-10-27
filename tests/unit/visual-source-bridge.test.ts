import { describe, expect, it } from 'vitest';
import {
  positionAtLfOffset,
  validateVisualEdits,
} from '../../src/renderer/src/features/visual-editor/source-bridge';

describe('visual source coordinates', () => {
  it('maps UTF-16 positions in normalized LF text to line and column', () => {
    const text = 'one\n😀x\nlast';
    expect(positionAtLfOffset(text, 0)).toEqual({ lineNumber: 1, column: 1 });
    expect(positionAtLfOffset(text, 6)).toEqual({ lineNumber: 2, column: 3 });
    expect(positionAtLfOffset(text, 8)).toEqual({ lineNumber: 3, column: 1 });
    expect(() => positionAtLfOffset(text, text.length + 1)).toThrow();
  });

  it('rejects out-of-bounds, inverted, or overlapping model edits', () => {
    expect(
      validateVisualEdits('abcdef', [
        { from: 1, to: 2, insert: 'X' },
        { from: 4, to: 6, insert: '' },
      ]),
    ).toBe(true);
    expect(
      validateVisualEdits('abcdef', [
        { from: 1, to: 4, insert: '' },
        { from: 3, to: 5, insert: '' },
      ]),
    ).toBe(false);
    expect(validateVisualEdits('abc', [{ from: 2, to: 4, insert: '' }])).toBe(false);
    expect(validateVisualEdits('abc', [{ from: 2, to: 1, insert: '' }])).toBe(false);
  });
});
