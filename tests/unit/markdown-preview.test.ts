import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks } from '../../src/renderer/src/features/markdown';

describe('Markdown preview parser', () => {
  it('parses the supported block types without interpreting HTML', () => {
    expect(
      parseMarkdownBlocks(
        [
          '# Heading',
          '',
          'A **strong** paragraph.',
          '',
          '- first',
          '- second',
          '',
          '1. one',
          '2. two',
          '',
          '```tex',
          '\\section{Safe}',
          '```',
        ].join('\n'),
      ),
    ).toEqual([
      { kind: 'heading', level: 1, text: 'Heading' },
      { kind: 'paragraph', text: 'A **strong** paragraph.' },
      { kind: 'list', listKind: 'unordered', items: ['first', 'second'] },
      { kind: 'list', listKind: 'ordered', items: ['one', 'two'] },
      { kind: 'code', language: 'tex', text: '\\section{Safe}' },
    ]);
  });

  it('keeps raw HTML in text rather than parsing it as markup', () => {
    expect(parseMarkdownBlocks('<img src=x onerror=alert(1)>')).toEqual([
      { kind: 'paragraph', text: '<img src=x onerror=alert(1)>' },
    ]);
  });
});
