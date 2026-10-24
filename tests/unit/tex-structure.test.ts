import { describe, expect, it } from 'vitest';
import { buildDocumentModel } from '../../src/shared/document-model';
import {
  buildFileIndex,
  cleanTitle,
  normalizeProjectPath,
  parseTexStructure,
  resolveReference,
} from '../../src/shared/tex-structure';

describe('parseTexStructure sections', () => {
  it('reads levels, starred forms, short titles and nested braces', () => {
    const { sections } = parseTexStructure(
      [
        '\\chapter{Intro}',
        '\\section*{Unnumbered}',
        '\\subsection[Short]{A \\textbf{bold} {nested {braces}} title}',
        '\\paragraph{Run-in}',
      ].join('\n'),
    );
    expect(sections.map((s) => [s.level, s.title, s.starred, s.line])).toEqual([
      [1, 'Intro', false, 1],
      [2, 'Unnumbered', true, 2],
      [3, 'A bold nested braces title', false, 3],
      [5, 'Run-in', false, 4],
    ]);
  });

  it('ignores comments, escaped percent signs and verbatim bodies', () => {
    const { sections, references } = parseTexStructure(
      [
        '% \\section{Commented out}',
        '\\section{Fifty\\% off} % \\section{trailing}',
        '\\begin{verbatim}',
        '\\section{In verbatim}',
        '\\input{ignored}',
        '\\end{verbatim}',
        '\\section{After}',
      ].join('\n'),
    );
    expect(sections.map((s) => [s.title, s.line])).toEqual([
      ['Fifty% off', 2],
      ['After', 7],
    ]);
    expect(references).toEqual([]);
  });

  it('does not treat longer command names as sections', () => {
    expect(parseTexStructure('\\sectionmark{x}\\subsectionfoo{y}').sections).toEqual([]);
  });

  it('tolerates unclosed braces and malformed inputs during active typing', () => {
    const { sections, references } = parseTexStructure(
      '\\section{Unfinished\n\n\\section{Completed}\n\\input{chapters/a}',
    );
    expect(sections).toEqual([
      expect.objectContaining({ command: 'section', line: 1 }),
      expect.objectContaining({ command: 'section', title: 'Completed', line: 3 }),
    ]);
    expect(references).toEqual([
      expect.objectContaining({ kind: 'tex', target: 'chapters/a', line: 4 }),
    ]);
  });

  it('ignores macro-like content inside minted and lstlisting environments', () => {
    const { sections } = parseTexStructure(
      [
        '\\section{Real}',
        '\\begin{minted}{latex}',
        '\\section{Fake in minted}',
        '\\end{minted}',
        '\\begin{lstlisting}',
        '\\section{Fake in listing}',
        '\\end{lstlisting}',
      ].join('\n'),
    );
    expect(sections.map((s) => s.title)).toEqual(['Real']);
  });

  it('cleans headings', () => {
    expect(cleanTitle('Results\\label{sec:r}')).toBe('Results');
    expect(cleanTitle('On \\emph{FMNE}\\footnote{note} entry~effects')).toBe(
      'On FMNE entry effects',
    );
  });
});

describe('parseTexStructure references', () => {
  const source = [
    '\\documentclass[12pt]{article}',
    '\\usepackage{amsmath, mystyle}',
    '\\graphicspath{{figures/}{img/}}',
    '\\input{chapters/a}',
    '\\include{chapters/b.tex}',
    '\\subfile{sub/c}',
    '\\import{lib/}{d}',
    '\\bibliography{refs, extra}',
    '\\addbibresource[location=local]{more.bib}',
    '\\addbibresource{https://example.com/x.bib}',
    '\\includegraphics[width=3cm]{plot}',
    '\\includegraphics{\\macro}',
    '\\lstinputlisting[language=R]{code/run.R}',
  ].join('\n');

  it('collects every kind of reference with its line', () => {
    const { references, graphicsPaths } = parseTexStructure(source);
    expect(graphicsPaths).toEqual(['figures', 'img']);
    expect(references.map((r) => [r.kind, r.target, r.line])).toEqual([
      ['package', 'article', 1],
      ['package', 'amsmath', 2],
      ['package', 'mystyle', 2],
      ['tex', 'chapters/a', 4],
      ['tex', 'chapters/b.tex', 5],
      ['tex', 'sub/c', 6],
      ['tex', 'lib/d', 7],
      ['bib', 'refs', 8],
      ['bib', 'extra', 8],
      ['bib', 'more.bib', 9],
      ['graphic', 'plot', 11],
      ['text', 'code/run.R', 13],
    ]);
  });
});

describe('resolveReference', () => {
  const index = buildFileIndex([
    'main.tex',
    'Chapters/Intro.tex',
    'chapters/deep/part.tex',
    'refs.bib',
    'figures/Plot.PNG',
    'mystyle.sty',
  ]);
  const ref = (
    kind: 'tex' | 'bib' | 'graphic' | 'package',
    target: string,
    extension?: string,
  ) => ({
    kind,
    command: 'x',
    target,
    line: 1,
    extension,
  });

  it('adds extensions and matches case-insensitively', () => {
    expect(resolveReference(ref('tex', 'chapters/intro'), 'main.tex', index)).toBe(
      'Chapters/Intro.tex',
    );
    expect(resolveReference(ref('bib', 'refs'), 'main.tex', index)).toBe('refs.bib');
  });

  it('falls back to the including file directory', () => {
    expect(resolveReference(ref('tex', 'part'), 'chapters/deep/x.tex', index)).toBe(
      'chapters/deep/part.tex',
    );
  });

  it('honours graphicspath and tries image extensions', () => {
    expect(resolveReference(ref('graphic', 'plot'), 'main.tex', index, ['figures'])).toBe(
      'figures/Plot.PNG',
    );
    expect(resolveReference(ref('graphic', 'plot'), 'main.tex', index)).toBeNull();
  });

  it('finds local style files only', () => {
    expect(resolveReference(ref('package', 'mystyle', '.sty'), 'main.tex', index)).toBe(
      'mystyle.sty',
    );
    expect(resolveReference(ref('package', 'amsmath', '.sty'), 'main.tex', index)).toBeNull();
  });

  it('never resolves outside the project', () => {
    expect(normalizeProjectPath('../secret')).toBeNull();
    expect(normalizeProjectPath('a/../../secret')).toBeNull();
    expect(resolveReference(ref('tex', '../main'), 'chapters/x.tex', index)).toBe('main.tex');
    expect(resolveReference(ref('tex', '../../main'), 'chapters/x.tex', index)).toBeNull();
  });
});

describe('buildDocumentModel', () => {
  const files: Record<string, string> = {
    'main.tex': [
      '\\documentclass{report}',
      '\\usepackage{amsmath}',
      '\\chapter{One}',
      '\\input{chapters/a}',
      '\\chapter{Two}',
      '\\include{chapters/missing}',
      '\\includegraphics{fig}',
      '\\includegraphics{fig}',
      '\\bibliography{refs}',
    ].join('\n'),
    'chapters/a.tex': '\\section{A1}\n\\input{chapters/b}\n\\section{A2}',
    'chapters/b.tex': '\\subsection{B1}\n\\input{chapters/a}',
    'fig.pdf': '',
    'refs.bib': '',
  };
  const options = {
    index: buildFileIndex(Object.keys(files)),
    readSource: async (path: string) => files[path] ?? null,
  };

  it('splices included headings into reading order', async () => {
    const model = await buildDocumentModel('main.tex', options);
    expect(model.outline.map((item) => [item.title, item.path, item.line])).toEqual([
      ['One', 'main.tex', 3],
      ['A1', 'chapters/a.tex', 1],
      ['B1', 'chapters/b.tex', 1],
      ['A2', 'chapters/a.tex', 3],
      ['Two', 'main.tex', 5],
    ]);
  });

  it('builds the used-files tree with missing files, duplicates and cycles', async () => {
    const { root } = await buildDocumentModel('main.tex', options);
    expect(root.children.map((n) => [n.kind, n.label, n.status])).toEqual([
      ['tex', 'a.tex', 'ok'],
      ['tex', 'chapters/missing', 'missing'],
      ['graphic', 'fig.pdf', 'ok'],
      ['bib', 'refs.bib', 'ok'],
    ]);
    const a = root.children[0];
    const b = a.children[0];
    expect(b.label).toBe('b.tex');
    expect(b.children[0]).toMatchObject({ label: 'a.tex', cycle: true, children: [] });
  });

  it('reports unchecked instead of missing when the listing is truncated', async () => {
    const model = await buildDocumentModel('main.tex', { ...options, listingComplete: false });
    expect(model.root.children[1].status).toBe('unchecked');
  });

  it('caps node count', async () => {
    const model = await buildDocumentModel('main.tex', { ...options, maxNodes: 2 });
    expect(model.limited).toBe(true);
    expect(model.root.children.length).toBeLessThanOrEqual(2);
  });
});
