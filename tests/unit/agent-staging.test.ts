import { describe, expect, it } from 'vitest';
import { StagingBuffer } from '../../src/main/services/agent-staging';

/** Validated edit operations, independent of any provider or SDK transcript. */
describe('staging buffer', () => {
  const staged = (content: string) => {
    const buffer = new StagingBuffer(content);
    buffer.read();
    return buffer;
  };

  it('edits the authorized document snapshot without a separate read', () => {
    const buffer = new StagingBuffer('Hello');
    expect(buffer.edit('insert_text', { offset: 0, text: 'x' })).toMatchObject({ staged: true });
    expect(buffer.staged).toBe('xHello');
  });

  it('stages exact UTF-16 insertions and replacements in memory only', () => {
    const buffer = staged('Hello world.');
    expect(
      buffer.edit('replace_range', { start: 6, end: 11, expected: 'world', text: 'LaTeX' }),
    ).toMatchObject({ staged: true });
    expect(buffer.edit('insert_text', { offset: 12, text: '\n' })).toMatchObject({ staged: true });
    expect(buffer.staged).toBe('Hello LaTeX.\n');
    expect(buffer.original).toBe('Hello world.');
  });

  it('deletes exact source ranges using a dedicated operation', () => {
    const buffer = staged('Before unwanted text after.');
    expect(buffer.edit('delete_range', { expected: 'unwanted text' })).toMatchObject({
      staged: true,
    });
    expect(buffer.staged).toBe('Before  after.');
  });

  it('uses offsets to disambiguate repeated deletion text', () => {
    const buffer = staged('remove this, then remove this');
    expect(
      buffer.edit('delete_range', {
        start: 0,
        end: 11,
        expected: 'remove this',
      }),
    ).toMatchObject({ staged: true });
    expect(buffer.staged).toBe(', then remove this');
  });

  it('inserts by Unicode line/column and reports the line table', () => {
    const buffer = new StagingBuffer('One\r\n😀 two\r\n');
    expect(buffer.read()).toMatchObject({
      lines: [
        { line: 1, offset: 0, text: 'One', endColumn: 4 },
        { line: 2, offset: 5, text: '😀 two', endColumn: 6 },
        { line: 3, offset: 13, text: '', endColumn: 1 },
      ],
      totalLines: 3,
    });
    buffer.edit('insert_text', { line: 2, column: 2, text: ' lorem ipsum' });
    expect(buffer.staged).toBe('One\r\n😀 lorem ipsum two\r\n');
  });

  it('returns precise column bounds so an invalid insertion can be corrected', () => {
    expect(
      staged('Hello world.').edit('insert_text', { line: 1, column: 14, text: 'x' }),
    ).toMatchObject({
      staged: false,
      error: { message: expect.stringContaining('Line 1 allows columns 1 through 13.') },
    });
  });

  it('asks the model to disambiguate repeated expected text', () => {
    expect(
      staged('same same').edit('replace_range', { expected: 'same', text: 'new' }),
    ).toMatchObject({ error: { message: expect.stringContaining('ambiguous') } });
  });

  it('rejects ranges splitting UTF-16 surrogate pairs', () => {
    expect(staged('a😀b').edit('insert_text', { offset: 2, text: 'x' })).toMatchObject({
      staged: false,
    });
  });

  it.each([
    { start: 0, end: 5, expected: 'WRONG', text: 'new' },
    { start: 0, end: 5, expected: 'Hello', text: '' },
    { start: 0, end: 5, expected: 'Hello', text: 'Hello' },
    { start: 0, end: 0, expected: '', text: 'x' },
  ])('returns invalid replacements as correctable errors: %#', (args) => {
    expect(staged('Hello world.').edit('replace_range', args)).toMatchObject({
      staged: false,
      error: { code: 'INVALID_TEXT_OPERATION', recoverable: true },
    });
  });

  it.each([
    { offset: -1, text: 'x' },
    { offset: 99, text: 'x' },
    { offset: 1.5, text: 'x' },
    { offset: '1', text: 'x' },
    { offset: 0, text: '' },
    { line: 1, offset: 0, text: 'x' },
  ])('returns invalid insertions as correctable errors: %#', (args) => {
    expect(staged('Hello').edit('insert_text', args)).toMatchObject({ staged: false });
  });

  it('can stage deleting the entire document for explicit user review', () => {
    const buffer = staged('Hello');
    expect(buffer.edit('delete_range', { expected: 'Hello' })).toMatchObject({ staged: true });
    expect(buffer.staged).toBe('');
  });

  it.each([
    { offset: 0, text: 'x', path: 'other.tex' },
    { expected: 'a', text: 'b', command: 'rm' },
  ])('treats unknown fields as fatal: %#', (args) => {
    expect(() => staged('a').edit('insert_text', args)).toThrow();
  });

  it('enforces the document size limit', () => {
    expect(() => staged('a').edit('insert_text', { offset: 0, text: 'a'.repeat(64_000) })).toThrow(
      /64,000-character/,
    );
  });
});
