import { describe, expect, it } from 'vitest';
import { bibliographyDetail, parseBibliography } from '../../src/shared/bibliography';

describe('parseBibliography', () => {
  it('extracts ordinary entry keys and compact completion details', () => {
    const entries = parseBibliography(`
      @article{knuth1984,
        author = {Donald E. Knuth and Someone Else},
        title = {Literate Programming},
        year = {1984}
      }
      @comment{not-a-citation}
    `);
    expect(entries).toEqual([
      expect.objectContaining({ key: 'knuth1984', type: 'article', title: 'Literate Programming' }),
    ]);
    expect(bibliographyDetail(entries[0])).toBe('Donald E. Knuth · 1984 · Literate Programming');
  });
});
