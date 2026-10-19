import { describe, expect, it } from 'vitest';
import { latexFoldingRanges } from '../../src/renderer/src/features/editor/folding';

const fold = (text: string) => latexFoldingRanges(text.split('\n'));

describe('LaTeX folding ranges', () => {
  it('folds environments but keeps the closing line visible', () => {
    expect(fold('\\begin{table}\n a\n b\n\\end{table}')).toEqual([{ start: 1, end: 3 }]);
  });

  it('nests environments and ignores commented markers', () => {
    const ranges = fold(
      [
        '\\begin{document}',
        '\\begin{itemize}',
        '\\item a',
        '% \\end{itemize}',
        '\\end{itemize}',
        '\\end{document}',
      ].join('\n'),
    );
    expect(ranges).toContainEqual({ start: 1, end: 5 });
    expect(ranges).toContainEqual({ start: 2, end: 4 });
  });

  it('folds sections up to the next section of the same or higher level', () => {
    const ranges = fold(
      ['\\section{A}', 'text', '\\subsection{B}', 'more', '', '\\section{C}', 'last'].join('\n'),
    );
    expect(ranges).toContainEqual({ start: 1, end: 4 });
    expect(ranges).toContainEqual({ start: 3, end: 4 });
    expect(ranges).toContainEqual({ start: 6, end: 7 });
  });

  it('stops sections at the end of the document body', () => {
    const ranges = fold(
      ['\\begin{document}', '\\section{A}', 'text', '\\end{document}'].join('\n'),
    );
    expect(ranges).toContainEqual({ start: 2, end: 3 });
    expect(ranges).toContainEqual({ start: 1, end: 3 });
  });

  it('folds runs of comment lines and ignores unmatched ends', () => {
    expect(fold('% a\n% b\ntext')).toEqual([{ start: 1, end: 2, comment: true }]);
    expect(fold('\\end{figure}\ntext')).toEqual([]);
  });
});
