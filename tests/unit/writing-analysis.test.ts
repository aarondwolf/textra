import { describe, expect, it } from 'vitest';
import {
  analyzeLatexDocument,
  analyzeMarkdownDocument,
  extractPromptContext,
  maskLatexComments,
  moveSectionInLatex,
} from '../../src/shared/writing-analysis';

describe('analyzeLatexDocument', () => {
  const source = [
    '% A regular comment',
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

  it('detects % TODO and % FIXME notes inside comments', () => {
    const result = analyzeLatexDocument(
      [
        '\\section{Intro}',
        '% FIXME: Fix this',
        'Text here.',
        '% TODO: review numbers',
        '\\begin{verbatim}',
        '% FIXME: ignored inside verbatim',
        '\\end{verbatim}',
      ].join('\n'),
    );
    expect(result.todos).toEqual([
      expect.objectContaining({ kind: 'FIXME', text: 'Fix this', line: 2 }),
      expect.objectContaining({ kind: 'TODO', text: 'review numbers', line: 4 }),
    ]);
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

describe('analyzeMarkdownDocument', () => {
  it('extracts headers with appropriate levels and line numbers', () => {
    const md = [
      '# Document Title',
      'Introduction text with some words.',
      '## Background',
      '### Prior Work',
      'TODO: write citation',
      '## Methodology',
      '#### Implementation details',
      '##### Fine details',
      '###### Sub fine details',
      'FIXME: verify equation $E = mc^2$',
    ].join('\n');

    const result = analyzeMarkdownDocument(md);
    expect(result.outline).toHaveLength(7);
    expect(result.outline[0]).toEqual({
      command: 'section',
      level: 1,
      title: 'Document Title',
      starred: false,
      line: 1,
    });
    expect(result.outline[1]).toEqual({
      command: 'subsection',
      level: 2,
      title: 'Background',
      starred: false,
      line: 3,
    });
    expect(result.outline[2]).toEqual({
      command: 'subsubsection',
      level: 3,
      title: 'Prior Work',
      starred: false,
      line: 4,
    });
    expect(result.outline[3]).toEqual({
      command: 'subsection',
      level: 2,
      title: 'Methodology',
      starred: false,
      line: 6,
    });
    expect(result.outline[4]).toEqual({
      command: 'paragraph',
      level: 4,
      title: 'Implementation details',
      starred: false,
      line: 7,
    });
    expect(result.todos).toHaveLength(2);
    expect(result.todos[0]).toMatchObject({ kind: 'TODO', text: 'write citation', line: 5 });
    expect(result.todos[1]).toMatchObject({ kind: 'FIXME', line: 10 });
    expect(result.counts.sections).toBe(7);
    expect(result.counts.equations).toBe(1);
    expect(result.counts.words).toBeGreaterThan(15);
  });

  describe('moveSectionInLatex', () => {
    const doc = [
      '\\documentclass{article}',
      '\\begin{document}',
      '\\section{First}',
      'Content 1',
      '\\subsection{Sub 1A}',
      'Sub content',
      '\\section{Second}',
      'Content 2',
      '\\section{Third}',
      'Content 3',
      '\\end{document}',
    ].join('\n');

    it('moves a section and its subsections before another section', () => {
      const { outline } = analyzeLatexDocument(doc);
      // Items: 0: First, 1: Sub 1A, 2: Second, 3: Third
      const reordered = moveSectionInLatex(doc, 2, 0, 'before', outline);
      const newAnalysis = analyzeLatexDocument(reordered);
      expect(newAnalysis.outline.map((o) => o.title)).toEqual([
        'Second',
        'First',
        'Sub 1A',
        'Third',
      ]);
      expect(reordered).toContain('\\section{Second}\nContent 2\n\\section{First}');
      expect(reordered).toContain('\\end{document}');
    });

    it('moves a section with its child subsections after another section', () => {
      const { outline } = analyzeLatexDocument(doc);
      // Move 'First' (idx 0) after 'Third' (idx 3)
      const reordered = moveSectionInLatex(doc, 0, 3, 'after', outline);
      const newAnalysis = analyzeLatexDocument(reordered);
      expect(newAnalysis.outline.map((o) => o.title)).toEqual([
        'Second',
        'Third',
        'First',
        'Sub 1A',
      ]);
      expect(reordered.indexOf('\\section{Second}')).toBeLessThan(
        reordered.indexOf('\\section{Third}'),
      );
      expect(reordered.indexOf('\\section{Third}')).toBeLessThan(
        reordered.indexOf('\\section{First}'),
      );
      expect(reordered.indexOf('\\subsection{Sub 1A}')).toBeGreaterThan(
        reordered.indexOf('\\section{First}'),
      );
    });

    it('moves a subsection within or between sections', () => {
      const multiSubDoc = [
        '\\section{A}',
        '\\subsection{A1}',
        'Text A1',
        '\\subsection{A2}',
        'Text A2',
        '\\section{B}',
      ].join('\n');
      const { outline } = analyzeLatexDocument(multiSubDoc);
      // Move A2 (idx 2) before A1 (idx 1)
      const reordered = moveSectionInLatex(multiSubDoc, 2, 1, 'before', outline);
      const newAnalysis = analyzeLatexDocument(reordered);
      expect(newAnalysis.outline.map((o) => o.title)).toEqual(['A', 'A2', 'A1', 'B']);
    });

    it('rejects moving a parent section into its own child subsection', () => {
      const { outline } = analyzeLatexDocument(doc);
      // Move 'First' (idx 0) into 'Sub 1A' (idx 1) -> invalid
      const unchanged = moveSectionInLatex(doc, 0, 1, 'before', outline);
      expect(unchanged).toBe(doc);
    });

    it('preserves CRLF line endings when present', () => {
      const crlfDoc = doc.replaceAll('\n', '\r\n');
      const { outline } = analyzeLatexDocument(crlfDoc);
      const reordered = moveSectionInLatex(crlfDoc, 2, 0, 'before', outline);
      expect(reordered).toContain('\r\n');
      expect(reordered).not.toMatch(/[^\r]\n/);
    });
  });
});
