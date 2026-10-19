import { describe, expect, it } from 'vitest';
import { insertion, SYMBOL_GROUPS } from '../../src/renderer/src/features/equations/symbols';

describe('equation symbols', () => {
  it('places the cursor at the marker or inside the first braces', () => {
    expect(insertion('\\alpha')).toEqual({ text: '\\alpha', caret: 6 });
    expect(insertion('\\frac{}{}')).toEqual({ text: '\\frac{}{}', caret: 6 });
    expect(insertion('\\left( $0 \\right)')).toEqual({ text: '\\left(  \\right)', caret: 7 });
  });

  it('has unique, well formed entries', () => {
    const seen = new Set<string>();
    for (const group of SYMBOL_GROUPS)
      for (const symbol of group.symbols) {
        expect(symbol.tex.length).toBeGreaterThan(0);
        expect(symbol.tex).not.toMatch(/\s{2,}$/);
        const key = group.name + symbol.tex;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    expect(SYMBOL_GROUPS.flatMap((group) => group.symbols).length).toBeGreaterThan(250);
  });
});
