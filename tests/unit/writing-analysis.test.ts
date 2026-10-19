import { describe, expect, it } from 'vitest';
import {
  analyzeLatexDocument,
  extractPromptContext,
  maskLatexComments,
} from '../../src/shared/writing-analysis';

describe('analyzeLatexDocument', () => {
  const source = [
    '% TODO: ignored',
    '\\section{A \\emph{clear} start}\\label{sec:start}',
    'Words are counted, but \\citep{knuth, lamport} is not words.',
    'See \\ref{sec:start}, \\eqref{eq:missing}, and \\Cref{sec:start}.',
    '\\begin{figure}',
    '  \\includegraphics[width=4cm]{plots/result.pdf}',
    '\\end{figure}',
    '\\begin{table} cell \\end{table}',
    '\\begin{equation} x = y \\end{equation} and $z$.',
    '% \\label{ignored}',
    'TODO: explain this',
    'FIXME author: check result',
    '\\label{sec:start}',
    '\\begin{verbatim}',
    '\\ref{also-ignored} TODO: ignored',
    '\\end{verbatim}',
  ].join('\n');

  it('extracts comment-aware document intelligence and counts', () => {
    const result = analyzeLatexDocument(source);
    expect(result.outline).toEqual([
      expect.objectContaining({ command: 'section', title: 'A clear start', line: 2 }),
    ]);
    expect(result.labels.map((item) => [item.value, item.line])).toEqual([
      ['sec:start', 2],
      ['sec:start', 13],
    ]);
    expect(result.references.map((item) => item.value)).toEqual([
      'sec:start',
      'eq:missing',
      'sec:start',
    ]);
    expect(result.citations.map((item) => item.value)).toEqual(['knuth', 'lamport']);
    expect(result.graphics.map((item) => item.value)).toEqual(['plots/result.pdf']);
    expect(result.todos).toEqual([
      expect.objectContaining({ kind: 'TODO', text: 'explain this', line: 11 }),
      expect.objectContaining({ kind: 'FIXME', text: 'author: check result', line: 12 }),
    ]);
    expect(result.counts).toMatchObject({
      sections: 1,
      tables: 1,
      figures: 1,
      equations: 2,
      citations: 2,
      todos: 2,
    });
    expect(result.counts.words).toBeGreaterThan(10);
    expect(result.referenceIssues).toEqual([
      expect.objectContaining({ kind: 'duplicate-label', value: 'sec:start' }),
      expect.objectContaining({ kind: 'missing-label', value: 'eq:missing' }),
    ]);
  });

  it('keeps escaped percent signs and masks actual comments', () => {
    const source = ['50\\% useful % hidden', 'visible'].join('\n');
    expect(maskLatexComments(source)).toBe('50\\% useful         \nvisible');
  });

  it('counts standalone graphics when no figure environment exists', () => {
    expect(
      analyzeLatexDocument('\\includegraphics{one}\\n\\includegraphics{two}').counts.figures,
    ).toBe(2);
  });
});

describe('extractPromptContext', () => {
  it('prefers the innermost complete environment around the target line', () => {
    const source = [
      'before',
      '\\begin{table}',
      '  \\begin{tabular}{c}',
      '  bad & row',
      '  \\end{tabular}',
      '\\end{table}',
      'after',
    ].join('\n');
    expect(extractPromptContext(source, 4)).toEqual({
      startLine: 3,
      endLine: 5,
      text: '  \\begin{tabular}{c}\n  bad & row\n  \\end{tabular}',
      environment: 'tabular',
    });
  });

  it('uses a bounded line window if no enclosing environment exists', () => {
    const source = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join('\n');
    expect(extractPromptContext(source, 4, 2)).toEqual({
      startLine: 2,
      endLine: 6,
      text: 'line 2\nline 3\nline 4\nline 5\nline 6',
      environment: null,
    });
  });
});
