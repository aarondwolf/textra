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

  it('correctly parses entries with nested braces and unquoted values', () => {
    const entries = parseBibliography(`
      @book{latexcompanion,
        author = {Mittelbach, Frank and Goossens, Michel},
        title = {The {\\LaTeX} {C}ompanion},
        year = 2004
      }
      @article{biblatexentry,
        author = "Smith, John",
        title = "A Study on {COVID-19} Dynamics",
        date = {2021-08-15}
      }
    `);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        key: 'latexcompanion',
        type: 'book',
        title: 'The LaTeX Companion',
        year: '2004',
      }),
    );
    expect(entries[1]).toEqual(
      expect.objectContaining({
        key: 'biblatexentry',
        type: 'article',
        title: 'A Study on COVID-19 Dynamics',
        year: '2021',
      }),
    );
  });
});
