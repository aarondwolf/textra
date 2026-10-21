import { describe, expect, it } from 'vitest';
import {
  buildCompletionContext,
  scanLatexCursor,
  isLatexSuggestionContext,
} from '../../src/shared/latex-completion';

const scan = (source: string) => scanLatexCursor(source, source.length);
describe('deterministic LaTeX suggestion contexts', () => {
  it('keeps command and structured argument completion', () => {
    for (const text of [
      '\\',
      '\\frac',
      '\\begin{equ',
      '\\cite{one,tw',
      '\\includegraphics[width=2cm]{fig',
      '\\usepackage{tik',
    ])
      expect(isLatexSuggestionContext(text), text).toBe(true);
  });
  it('does not query word completion for prose or literal line breaks', () => {
    for (const text of ['Th', 'The theorem', '\\textbf{Th', '\\\\Th', 'ordinary {Th'])
      expect(isLatexSuggestionContext(text), text).toBe(false);
  });
});
describe('cursor-aware LaTeX completion context', () => {
  it('tracks nested custom and unfinished environments without treating document as eligible', () => {
    expect(scan('\\begin{document}\nProse').eligible).toBe(false);
    expect(scan('\\begin{document}\\begin{custom}\\begin{proof}x').environments).toEqual([
      'document',
      'custom',
      'proof',
    ]);
    expect(scan('\\begin{custom}x\\end{custom}').eligible).toBe(false);
    expect(scan('\\begin{abstract}Unfinished').eligible).toBe(true);
  });
  it('tracks dollar and escaped math delimiters', () => {
    for (const source of ['$x', '$$x', '\\(x', '\\[x']) expect(scan(source).eligible).toBe(true);
    for (const source of ['$x$', '$$x$$', '\\(x\\)', '\\[x\\]', '\\$x', '\\\\(x'])
      expect(scan(source).eligible).toBe(false);
  });
  it('excludes comments and inline verb while honoring escaped percent signs', () => {
    expect(scan('\\begin{equation}% x').excluded).toBe(true);
    expect(scan('\\begin{equation}\\% x').excluded).toBe(false);
    expect(scan('\\begin{equation}\\\\% x').excluded).toBe(true);
    expect(scan('\\begin{proof}\\verb|%\\end{proof}').excluded).toBe(true);
    expect(scan('\\begin{proof}\\verb|%| x').eligible).toBe(true);
    expect(scan('\\begin{proof}\\verb|unfinished\nnext line').excluded).toBe(false);
    expect(scan('\\begin{comment}\\begin{equation}x').excluded).toBe(true);
    expect(scan('\\begin{comment}x\\end{comment} prose').eligible).toBe(false);
  });
  it('preserves literal blocks and their embedded language', () => {
    const minted = scan('\\begin{minted}[linenos]{python}\nx = 4 % 2; \\begin{fake} $');
    expect(minted).toMatchObject({
      eligible: true,
      excluded: false,
      literal: true,
      language: 'python',
      environments: ['minted'],
      math: null,
    });
    expect(scan('\\begin{lstlisting}[language={C++},numbers=left]\n% \\begin{x}').language).toBe(
      'C++',
    );
    expect(scan('\\begin{verbatim}\\% $').language).toBe('text');
    expect(scan('\\begin{minted}{unknown-custom-language}\\% $').language).toBe('text');
    expect(scan('\\begin{minted}{python}x\\end{minted} prose').literal).toBe(false);
  });
  it('scans only to the insertion offset and bounds literal contiguous context', () => {
    expect(scanLatexCursor('\\begin{equation}x\\end{equation}', 18).eligible).toBe(true);
    const source = 'p'.repeat(20_000) + '\\begin{equation}' + 's'.repeat(6_000);
    const automatic = buildCompletionContext(source, 20_016, 'completion');
    expect(automatic.prefix).toBe(source.slice(12_016, 20_016));
    expect(automatic.suffix).toBe(source.slice(20_016, 22_016));
    expect(automatic.metadata.length).toBeLessThanOrEqual(2_000);
    const manual = buildCompletionContext(source, 20_016, 'inlineCompletion');
    expect(manual.prefix.length).toBe(16_000);
    expect(manual.suffix.length).toBe(4_000);
  });
});
