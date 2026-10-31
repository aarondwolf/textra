import { describe, expect, it } from 'vitest';
import katex from 'katex';
import {
  importLatex,
  projectChanges,
  sourceOffsetForPosition,
  type VisualNode,
} from '../../src/renderer/src/features/visual-editor/latex-adapter';

const fixture = String.raw`\documentclass{article}
\begin{document}
\section*[Short]{Hello \textbf{world}}

Revenue grew 50\% in A\_B, $x^2$ and \cite{source}. % note
Next line.

\begin{figure}
\includegraphics{plot.pdf}
\end{figure}

\begin{itemize}
\item First
\item Second
\end{itemize}
\end{document}
`;

function clone<T>(value: T): T {
  return structuredClone(value);
}
function apply(
  source: string,
  edits: readonly { from: number; to: number; insert: string }[],
): string {
  return [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce((text, edit) => text.slice(0, edit.from) + edit.insert + text.slice(edit.to), source);
}
function findText(node: VisualNode, text: string): VisualNode | undefined {
  if (node.type === 'text' && node.text?.includes(text)) return node;
  return node.content?.map((child) => findText(child, text)).find(Boolean);
}
function findMarkedText(node: VisualNode, text: string, mark: string): VisualNode | undefined {
  if (
    node.type === 'text' &&
    node.text?.includes(text) &&
    node.marks?.some((item) => item.type === mark)
  )
    return node;
  return node.content?.map((child) => findMarkedText(child, text, mark)).find(Boolean);
}

describe('visual LaTeX adapter', () => {
  it('hides default layout commands and standalone comments without changing source', () => {
    const source = String.raw`% Comment one
% Comment two
\clearpage
\noindent First paragraph.

Other text. \FloatBarrier{}More text.`;
    const projection = importLatex(source);
    const nodes = projection.doc.content!;
    expect(nodes[0].attrs).toMatchObject({
      label: 'Comments',
      hidden: true,
      raw: '% Comment one\n% Comment two\n',
    });
    const paragraph = nodes[1];
    expect(paragraph.type).toBe('paragraph');
    expect(paragraph.content![0].attrs).toMatchObject({ hidden: true, raw: '\\clearpage\n' });
    expect(paragraph.content![1].attrs).toMatchObject({
      hidden: true,
      raw: String.raw`\noindent `,
    });
    const ref = String(paragraph.attrs?.sourceId);
    expect(sourceOffsetForPosition(projection, ref, 0)).toBe(source.indexOf('First'));
    const other = nodes[2];
    expect(other.content!.find((node) => node.attrs?.hidden)?.attrs?.raw).toBe(
      String.raw`\FloatBarrier{}`,
    );
    const changed = clone(projection.doc);
    const text = findText(changed, 'First')!;
    text.text = text.text!.replace('First', 'Updated');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('First', 'Updated'));
    const removed = clone(projection.doc);
    removed.content![1].content = removed.content![1].content!.filter(
      (node) => node.attrs?.hidden !== true,
    );
    expect(projectChanges(projection, removed).ok).toBe(false);
  });
  it('renders ignored landscape contents while protecting its original wrappers', () => {
    const source = String.raw`Before.

\begin{landscape}
  % Keep this comment
  \section{Landscape heading}

  Landscape prose.
\end{landscape}

After.`;
    const projection = importLatex(source);
    const environment = projection.doc.content![1];
    expect(environment.type).toBe('ignoredEnvironment');
    expect(environment.attrs).toMatchObject({
      environment: 'landscape',
      open: String.raw`\begin{landscape}`,
      close: String.raw`\end{landscape}`,
    });
    expect(environment.content?.map((node) => node.type)).toEqual([
      'opaqueBlock',
      'heading',
      'paragraph',
    ]);
    expect(environment.content![0].attrs?.hidden).toBe(true);
    const changed = clone(projection.doc);
    const text = findText(changed, 'Landscape prose')!;
    text.text = text.text!.replace('Landscape prose', 'Updated prose');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(apply(source, result.edits)).toBe(source.replace('Landscape prose', 'Updated prose'));
    const removed = clone(projection.doc);
    removed.content = removed.content!.filter((node) => node.type !== 'ignoredEnvironment');
    expect(projectChanges(projection, removed).ok).toBe(false);
  });
  it('uses per-call ignore configuration and preserves other environments as source', () => {
    const source = String.raw`Before \myspace After.

\begin{custom}Inside.\end{custom}`;
    const projection = importLatex(source, {
      ignoredCommands: ['myspace'],
      ignoredEnvironments: ['custom'],
    });
    expect(projection.doc.content![0].content!.find((node) => node.attrs?.hidden)?.attrs?.raw).toBe(
      String.raw`\myspace `,
    );
    expect(projection.doc.content![1].type).toBe('ignoredEnvironment');
    expect(findText(projection.doc, 'Inside')).toBeDefined();
    const noIgnores = importLatex(source, { ignoredCommands: [], ignoredEnvironments: [] });
    expect(
      noIgnores.doc.content![0].content!.find((node) => node.type === 'opaqueInline')?.attrs
        ?.hidden,
    ).not.toBe(true);
    expect(noIgnores.doc.content![1].type).toBe('opaqueBlock');
  });
  it('keeps ignored commands with nonempty arguments visible and protected', () => {
    for (const macro of [
      String.raw`\customhide{value} rest`,
      String.raw`\customhide [option] rest`,
      String.raw`\customhide {value} rest`,
    ]) {
      const source = `Before ${macro}`;
      const projection = importLatex(source, { ignoredCommands: ['customhide'] });
      const atom = projection.doc.content![0].content!.find((node) => node.type === 'opaqueInline');
      expect(atom?.attrs).toMatchObject({ raw: macro, label: 'customhide' });
      expect(atom?.attrs?.hidden).not.toBe(true);
      const changed = clone(projection.doc);
      const before = findText(changed, 'Before')!;
      before.text = before.text!.replace('Before', 'After');
      const result = projectChanges(projection, changed);
      expect(result.ok).toBe(true);
      if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Before', 'After'));
    }
  });
  it('retains optional arguments in ignored environment wrappers without displaying them as prose', () => {
    const source = String.raw`\begin{custom}[label={Example}]
Visible contents.
\end{custom}`;
    const projection = importLatex(source, { ignoredEnvironments: ['custom'] });
    const environment = projection.doc.content![0];
    expect(environment.type).toBe('ignoredEnvironment');
    expect(findText(environment, 'Visible contents')).toBeDefined();
    expect(findText(environment, 'label')).toBeUndefined();
    const changed = clone(projection.doc);
    const text = findText(changed, 'Visible contents')!;
    text.text = text.text!.replace('Visible', 'Updated');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Visible', 'Updated'));
  });
  it('maps visible positions on either side of a hidden token to safe source boundaries', () => {
    const source = String.raw`Before \noindent After.`;
    const projection = importLatex(source);
    const id = projection.blocks[0].id;
    expect(sourceOffsetForPosition(projection, id, 'Before '.length)).toBe(source.indexOf('After'));
    expect(sourceOffsetForPosition(projection, id, 'Before A'.length)).toBe(
      source.indexOf('After') + 1,
    );
  });
  it('allows text inside an empty ignored environment while retaining boundaries', () => {
    const source = String.raw`\begin{landscape}

\end{landscape}`;
    const projection = importLatex(source);
    expect(projection.doc.content![0].type).toBe('ignoredEnvironment');
    const changed = clone(projection.doc);
    changed.content![0].content![0].content = [{ type: 'text', text: 'Added' }];
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('\n\n', '\nAdded\n'));
  });
  it('renders display math delimiters and common multiline environments without changing source', () => {
    const samples = [
      String.raw`\[x^2\]`,
      String.raw`\[x^2\label{eq:x}\]`,
      String.raw`$$x^2$$`,
      String.raw`$$x^2\label{eq:x}$$`,
      String.raw`$$$$`,
      String.raw`\begin{displaymath}x^2\end{displaymath}`,
      String.raw`\begin{equation}x^2\label{eq:x}\end{equation}`,
      String.raw`\begin{equation}[0,1]\end{equation}`,
      String.raw`\begin{equation*}x^2\end{equation*}`,
      String.raw`\begin{align}x&=y\label{eq:a}\\ y&=z\notag\end{align}`,
      String.raw`\begin{align*}x&=y\\ y&=z\end{align*}`,
      String.raw`\begin{alignat}{2}x&=y& z&=w\end{alignat}`,
      String.raw`\begin{gather*}x=y\\ y=z\end{gather*}`,
      String.raw`\begin{multline}x+y\\ =z\end{multline}`,
      String.raw`\begin{eqnarray}x&=&y\\ y&=&z\end{eqnarray}`,
    ];
    for (const formula of samples) {
      const source = `Before.\n\n${formula}\n\nAfter.`;
      const projection = importLatex(source);
      const math = projection.doc.content![1];
      expect(math.type, formula).toBe('blockMath');
      expect(math.attrs?.raw).toBe(formula);
      expect(() =>
        katex.renderToString(String(math.attrs?.renderLatex), {
          displayMode: true,
          throwOnError: true,
          trust: false,
        }),
      ).not.toThrow();
      const unchanged = projectChanges(projection, clone(projection.doc));
      expect(unchanged.ok).toBe(true);
      if (unchanged.ok) expect(unchanged.edits).toEqual([]);
      const changed = clone(projection.doc);
      findText(changed, 'Before')!.text = 'Changed.';
      const result = projectChanges(projection, changed);
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(apply(source, result.edits)).toBe(source.replace('Before.', 'Changed.'));
    }
  });
  it('removes metadata for rendering only while keeping formula source and editing delimiters exact', () => {
    const source = String.raw`\begin{align*}
a &= b \label{eq:a} \\
c &= d \tag*{\theequation} \nonumber
\end{align*}`;
    const projection = importLatex(source);
    const node = projection.doc.content![0];
    expect(node.type).toBe('blockMath');
    expect(node.attrs?.raw).toBe(source);
    expect(node.attrs?.latex).toContain(String.raw`\label{eq:a}`);
    expect(node.attrs?.latex).toContain(String.raw`\tag*{\theequation}`);
    expect(node.attrs?.renderLatex).not.toContain(String.raw`\label`);
    expect(node.attrs?.renderLatex).not.toContain(String.raw`\tag`);
    expect(node.attrs?.renderLatex).not.toContain(String.raw`\nonumber`);
    expect(() =>
      katex.renderToString(String(node.attrs?.renderLatex), {
        displayMode: true,
        throwOnError: true,
        trust: false,
      }),
    ).not.toThrow();
    const nested = importLatex(
      String.raw`\begin{equation}\begin{aligned} x &= y \label{eq:x} \end{aligned}\end{equation}`,
    );
    expect(nested.doc.content![0].type).toBe('blockMath');
    expect(nested.doc.content![0].attrs?.renderLatex).not.toContain(String.raw`\label`);
    const changed = clone(projection.doc);
    changed.content![0].attrs!.latex = '\na &= c\n';
    const applied = projectChanges(projection, changed);
    expect(applied.ok).toBe(true);
    if (applied.ok)
      expect(apply(source, applied.edits)).toBe(
        String.raw`\begin{align*}` + '\na &= c\n' + String.raw`\end{align*}`,
      );
    const comment = importLatex(String.raw`\begin{equation}x % \label{not-a-command}
+ y\end{equation}`);
    expect(comment.doc.content![0].attrs?.renderLatex).toContain(
      String.raw`% \label{not-a-command}`,
    );
    const adjacent = importLatex(String.raw`\begin{equation}\alpha\label{x}b\end{equation}`);
    expect(adjacent.doc.content![0].attrs?.renderLatex).toBe(String.raw`\alpha b`);
    expect(() =>
      katex.renderToString(String(adjacent.doc.content![0].attrs?.renderLatex), {
        throwOnError: true,
        trust: false,
      }),
    ).not.toThrow();
  });
  it('keeps inline math environments inline and protects ambiguous labels', () => {
    const projection = importLatex(String.raw`Before \begin{math}x^2\end{math} after.`);
    expect(projection.doc.content![0].type).toBe('paragraph');
    expect(
      projection.doc.content![0].content!.find((node) => node.type === 'inlineMath')?.attrs?.latex,
    ).toBe('x^2');
    const malformed = importLatex(String.raw`\begin{equation} x\label{broken \end{equation}`);
    expect(malformed.doc.content![0].type).toBe('opaqueBlock');
  });
  it('renders underline, small caps, superscript and subscript while retaining source syntax', () => {
    const source = String.raw`\underline{Underlined} and \textsc{Small Caps} with 10\textsuperscript{th} H\textsubscript{2}O.`;
    const projection = importLatex(source);
    expect(projection.doc.content![0].type).toBe('paragraph');
    for (const [text, mark] of [
      ['Underlined', 'underline'],
      ['Small Caps', 'smallCaps'],
      ['th', 'superscript'],
      ['2', 'subscript'],
    ]) {
      expect(findMarkedText(projection.doc, text, mark)?.marks).toContainEqual({ type: mark });
    }
    const changed = clone(projection.doc);
    findText(changed, 'Underlined')!.text = 'Changed';
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(apply(source, result.edits)).toBe(source.replace('Underlined', 'Changed'));
  });
  it('renders common symbols and accents as removable source-preserving glyphs', () => {
    const source = String.raw`Price \pounds{}100, caf\'{e}, caf\'eclair and M\"{u}ller with \LaTeX{}.`;
    const projection = importLatex(source);
    const nodes = projection.doc.content![0].content!;
    const glyphs = nodes
      .filter((node) => node.type === 'opaqueInline' && node.attrs?.visualText)
      .map((node) => [node.attrs?.raw, node.attrs?.visualText]);
    expect(glyphs).toEqual([
      [String.raw`\pounds{}`, '£'],
      [String.raw`\'{e}`, 'é'],
      [String.raw`\'e`, 'é'],
      [String.raw`\"{u}`, 'ü'],
      [String.raw`\LaTeX{}`, 'LaTeX'],
    ]);
    const id = projection.blocks[0].id;
    const visible = 'Price £100, café';
    expect(sourceOffsetForPosition(projection, id, visible.length)).toBe(
      source.indexOf('}', source.indexOf(String.raw`\'{e}`)) + 1,
    );
    const changed = clone(projection.doc);
    const price = findText(changed, 'Price')!;
    price.text = price.text!.replace('Price', 'Cost');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Price', 'Cost'));
    const removed = clone(projection.doc);
    removed.content![0].content = removed.content![0].content!.filter(
      (node) => node.attrs?.visualText !== '£',
    );
    const deletion = projectChanges(projection, removed);
    expect(deletion.ok).toBe(true);
    if (deletion.ok)
      expect(apply(source, deletion.edits)).toBe(source.replace(String.raw`\pounds{}`, ''));
  });
  it('maps control-word symbols and bare accents to source boundaries', () => {
    const source = String.raw`A \LaTeX{} B caf\'eclair \oe{}uvre`;
    const projection = importLatex(source);
    const id = projection.blocks[0].id;
    expect(sourceOffsetForPosition(projection, id, 'A LaTeX'.length)).toBe(source.indexOf('}') + 1);
    expect(sourceOffsetForPosition(projection, id, 'A LaTeX B café'.length)).toBe(
      source.indexOf(String.raw`\'e`) + String.raw`\'e`.length,
    );
    expect(sourceOffsetForPosition(projection, id, 'A LaTeX B caféclair œ'.length)).toBe(
      source.indexOf('}', source.indexOf(String.raw`\oe`)) + 1,
    );
    const unsafe = importLatex(String.raw`Prefix \'{ab} suffix`);
    expect(
      unsafe.doc.content![0].content!.find((node) => node.type === 'opaqueInline')?.attrs?.raw,
    ).toBe(String.raw`\'{ab} suffix`);
  });
  it('preserves symbol commands and scopes inside inline formatting', () => {
    const source = String.raw`\textsc{Cost \pounds{}10} and \underline{caf\'{e}}.`;
    const projection = importLatex(source);
    const glyph = projection.doc.content![0].content!.find(
      (node) => node.attrs?.visualText === '£',
    );
    expect(glyph?.marks).toContainEqual({ type: 'smallCaps' });
    const changed = clone(projection.doc);
    const text = findText(changed, 'Cost')!;
    text.text = text.text!.replace('Cost', 'Price');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = apply(source, result.edits);
      expect(output).toContain(String.raw`\textsc{\pounds{}}`);
      expect(output).toContain(String.raw`\'{e}`);
    }
  });
  it('renders href and url labels as protected atoms and preserves their destinations', () => {
    const source = String.raw`See \href{https://example.com}{A \textbf{link}} and \url{https://example.org}.`;
    const projection = importLatex(source);
    const atoms = projection.doc.content![0].content!.filter(
      (node) => node.type === 'opaqueInline',
    );
    expect(atoms.map((node) => node.attrs?.label)).toEqual([
      'href: A link',
      'url: https://example.org',
    ]);
    const changed = clone(projection.doc);
    findText(changed, 'See')!.text = 'Visit ';
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('See ', 'Visit '));
    const removed = clone(projection.doc);
    removed.content![0].content = removed.content![0].content!.filter(
      (node) => node.type !== 'opaqueInline',
    );
    expect(projectChanges(projection, removed).ok).toBe(false);
  });
  it('groups consecutive standalone comments, keeps inline comments inline, and preserves exact newlines', () => {
    const source = `% One\n% Two\n\nFirst. % Inline\ncontinued.\n\nLast.`;
    const projection = importLatex(source);
    expect(projection.doc.content?.map((node) => node.type)).toEqual([
      'opaqueBlock',
      'paragraph',
      'paragraph',
    ]);
    const comments = projection.doc.content![0];
    expect(comments.attrs).toMatchObject({ label: 'Comments', raw: '% One\n% Two\n' });
    expect(
      projection.doc.content![1].content!.some((node) => node.attrs?.label === 'Comment'),
    ).toBe(true);
    const changed = clone(projection.doc);
    findText(changed, 'Last')!.text = 'Changed.';
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Last.', 'Changed.'));
  });
  it('keeps the newline terminating an inline comment when editing the paragraph', () => {
    const source = 'First. % Inline\n\nNext paragraph.';
    const projection = importLatex(source);
    const paragraph = projection.doc.content![0];
    const comment = paragraph.content!.find((node) => node.attrs?.label === 'Comment');
    expect(comment?.attrs?.raw).toBe(' % Inline\n');
    const changed = clone(projection.doc);
    const text = findText(changed, 'First')!;
    text.text = text.text!.replace('First', 'Changed');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('First', 'Changed'));
  });
  it('renders quote and dash punctuation as ordinary literal editable prose', () => {
    const source = `He said \`\`hello'' -- and "goodbye" --- now.`;
    const projection = importLatex(source);
    const nodes = projection.doc.content![0].content!;
    expect(nodes.every((node) => node.type === 'text')).toBe(true);
    expect(nodes.map((node) => node.text).join('')).toBe(source);
    const changed = clone(projection.doc);
    const text = findText(changed, 'hello')!;
    text.text = text.text!.replace('-- and', '- and').replace("hello''", "hi'");
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(apply(source, result.edits)).toBe(`He said \`\`hi' - and "goodbye" --- now.`);
    const id = projection.blocks[0].id;
    const insideDashes = source.indexOf('--') + 1;
    expect(sourceOffsetForPosition(projection, id, insideDashes)).toBe(insideDashes);
  });
  it('preserves punctuation inside styled text when editing adjacent prose', () => {
    const source = "\\textbf{``Hello'' -- world} end.";
    const projection = importLatex(source);
    const changed = clone(projection.doc);
    const text = findText(changed, 'world')!;
    text.text = text.text!.replace('world', 'people');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('world', 'people'));
  });
  it('shows prose before an unknown command while protecting the full ambiguous paragraph tail', () => {
    for (const command of [
      String.raw`\custom[option]{argument}`,
      String.raw`\lipsum[1][1-3]`,
      String.raw`\custom{argument} trailing text`,
      String.raw`\custom argument`,
    ]) {
      const source = `Before ${command}`;
      const projection = importLatex(source);
      expect(projection.doc.content![0].type).toBe('paragraph');
      expect(
        projection.doc.content![0].content!.find((node) => node.type === 'opaqueInline')?.attrs
          ?.raw,
      ).toBe(command);
      const changed = clone(projection.doc);
      const text = findText(changed, 'Before')!;
      text.text = text.text!.replace('Before', 'Updated');
      const result = projectChanges(projection, changed);
      expect(result.ok).toBe(true);
      if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Before', 'Updated'));
      const removed = clone(projection.doc);
      removed.content![0].content = removed.content![0].content!.filter(
        (node) => node.type !== 'opaqueInline',
      );
      expect(projectChanges(projection, removed).ok).toBe(false);
    }
  });
  it('keeps unknown macro tails exact across comments and source line wrapping', () => {
    const source = String.raw`Opening \unknown[option]{argument} tail % keep comment
continued $x^2$ and \ref{key}.

Next paragraph.`;
    const projection = importLatex(source);
    const paragraph = projection.doc.content![0];
    expect(paragraph.type).toBe('paragraph');
    const atom = paragraph.content!.find((node) => node.type === 'opaqueInline');
    expect(atom?.attrs?.raw).toBe(String.raw`\unknown[option]{argument} tail % keep comment
continued $x^2$ and \ref{key}.`);
    const changed = clone(projection.doc);
    findText(changed, 'Opening')!.text = 'Changed ';
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Opening ', 'Changed '));
  });
  it('preserves a nonbreaking space as source while allowing ordinary deletion', () => {
    const source = String.raw`See Figure~\ref{fig:simple} for details.`;
    const projection = importLatex(source);
    const nodes = projection.doc.content![0].content!;
    const space = nodes.find((node) => node.type === 'opaqueInline' && node.attrs?.raw === '~');
    const reference = nodes.find(
      (node) => node.type === 'opaqueInline' && node.attrs?.raw === String.raw`\ref{fig:simple}`,
    );
    expect(space?.attrs?.label).toBe('Nonbreaking space');
    expect(reference?.attrs?.label).toBe('ref: fig:simple');
    const changed = clone(projection.doc);
    const before = findText(changed, 'Figure')!;
    before.text = before.text!.replace('Figure', 'Fig.');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Figure', 'Fig.'));
    const removed = clone(projection.doc);
    removed.content![0].content = removed.content![0].content!.filter(
      (node) => node.attrs?.raw !== '~',
    );
    const deletion = projectChanges(projection, removed);
    expect(deletion.ok).toBe(true);
    if (deletion.ok) expect(apply(source, deletion.edits)).toBe(source.replace('~', ''));
  });
  it('keeps nonbreaking spaces inside their existing text formatting', () => {
    const source = String.raw`\textbf{Hello~world}`;
    const projection = importLatex(source);
    const paragraph = projection.doc.content![0];
    expect(paragraph.type).toBe('paragraph');
    const space = paragraph.content!.find((node) => node.attrs?.raw === '~');
    expect(space?.marks).toEqual([{ type: 'bold' }]);
    const changed = clone(projection.doc);
    findText(changed, 'Hello')!.text = 'Greetings';
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(apply(source, result.edits)).toBe(
        String.raw`\textbf{Greetings}\textbf{~}\textbf{world}`,
      );
  });
  it('shows common reference and citation keys as protected source atoms', () => {
    const samples = [
      [String.raw`\Cref{fig:one}`, 'Cref: fig:one'],
      [String.raw`\vpageref*{sec:intro}`, 'vpageref: sec:intro'],
      [String.raw`\cpageref{tbl:one}`, 'cpageref: tbl:one'],
      [String.raw`\autocite[see][p. 3]{doe,smith}`, 'autocite: doe,smith'],
      [String.raw`\crefrange{eq:a}{eq:b}`, 'crefrange: eq:a–eq:b'],
    ];
    for (const [command, label] of samples) {
      const source = `Before ${command} after.`;
      const projection = importLatex(source);
      const atom = projection.doc.content![0].content!.find((node) => node.type === 'opaqueInline');
      expect(atom?.attrs).toMatchObject({ raw: command, label });
      const changed = clone(projection.doc);
      const text = findText(changed, 'Before')!;
      text.text = text.text!.replace('Before', 'Changed');
      const result = projectChanges(projection, changed);
      expect(result.ok).toBe(true);
      if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Before', 'Changed'));
      const removed = clone(projection.doc);
      removed.content![0].content = removed.content![0].content!.filter(
        (node) => node.type !== 'opaqueInline',
      );
      expect(projectChanges(projection, removed).ok).toBe(false);
    }
    expect(importLatex(String.raw`Text \crefrange{eq:only}`).doc.content![0].type).toBe(
      'opaqueBlock',
    );
  });
  it('edits lists with options, custom item labels, nested lists, and embedded equations without changing other source', () => {
    const source = String.raw`\begin{itemize}[label={[$\alpha$]},noitemsep]
\item First item with text.
\item[Custom] Second item with inline math $E=mc^2$ and an equation:
\begin{equation*}
    x^2 + y^2 = z^2
\end{equation*}
\begin{enumerate}[leftmargin=2em]
  \item Nested.
\end{enumerate}
\item Third Figure~\ref{fig:simple}.
\end{itemize}`;
    const projection = importLatex(source);
    const list = projection.doc.content![0];
    expect(list.type).toBe('bulletList');
    expect(list.attrs?.latexOptions).toBe('[label={[$\\alpha$]},noitemsep]');
    expect(list.content).toHaveLength(3);
    expect(list.content![1].attrs?.latexItemLabel).toBe('[Custom]');
    expect(list.content![1].content?.map((node) => node.type)).toEqual([
      'paragraph',
      'blockMath',
      'orderedList',
    ]);
    expect(list.content![1].content![2].attrs?.latexOptions).toBe('[leftmargin=2em]');
    const changed = clone(projection.doc);
    const text = findText(changed, 'Second item')!;
    text.text = text.text!.replace('Second item', 'Updated item');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(apply(source, result.edits)).toBe(source.replace('Second item', 'Updated item'));
  });
  it('preserves empty optional item labels when typing and generating source', () => {
    const source = String.raw`\begin{enumerate}[noitemsep]
\item [Custom]
\item Second
\end{enumerate}`;
    const projection = importLatex(source);
    const item = projection.doc.content![0].content![0];
    expect(item.attrs?.latexItemLabel).toBe('[Custom]');
    const changed = clone(projection.doc);
    changed.content![0].content![0].content![0].content = [{ type: 'text', text: 'Added' }];
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(apply(source, result.edits)).toBe(source.replace('[Custom]', '[Custom]Added'));
  });
  it('keeps empty plain list items valid when text is entered', () => {
    const source = String.raw`\begin{itemize}[noitemsep]
\item
\item Second
\end{itemize}`;
    const projection = importLatex(source);
    expect(projection.doc.content![0].type).toBe('bulletList');
    const changed = clone(projection.doc);
    changed.content![0].content![0].content![0].content = [{ type: 'text', text: 'Added' }];
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(apply(source, result.edits)).toBe(source.replace('\\item\n', '\\item Added\n'));
  });
  it('falls back to protected source for malformed or ambiguous list options', () => {
    for (const source of [
      String.raw`\begin{itemize}[broken
\item First
\end{itemize}`,
      String.raw`\begin{itemize}[noitemsep]
% preserve hidden list comment
\item First
\end{itemize}`,
      String.raw`\begin{itemize}
\item[unclosed
\end{itemize}`,
    ]) {
      const projection = importLatex(source);
      expect(projection.doc.content![0].type).toBe('opaqueBlock');
      expect(projection.doc.content![0].attrs?.raw).toBe(source);
      const result = projectChanges(projection, clone(projection.doc));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.edits).toEqual([]);
    }
  });
  it('preserves opaque complex environments and unknown paragraphs inside a list', () => {
    const source = String.raw`\begin{enumerate}[noitemsep]
\item Visible first.
\begin{figure}
\includegraphics{file}
\end{figure}
\begin{table}
\begin{tabular}{c} x \end{tabular}
\end{table}
\item Before \custom {argument} unknown text.
\end{enumerate}`;
    const projection = importLatex(source);
    const list = projection.doc.content![0];
    expect(list.type).toBe('orderedList');
    const firstItem = list.content![0];
    const group = firstItem.content!.find((node) => node.type === 'opaqueBlock');
    expect(group?.attrs?.raw).toContain('\\end{figure}\n\\begin{table}');
    expect(
      list.content![1].content![0].content!.some(
        (node) =>
          node.type === 'opaqueInline' &&
          node.attrs?.raw === String.raw`\custom {argument} unknown text.`,
      ),
    ).toBe(true);
    const changed = clone(projection.doc);
    const text = findText(changed, 'Visible')!;
    text.text = text.text!.replace('Visible', 'Updated');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Visible', 'Updated'));
  });
  it('groups consecutive opaque blocks and retains their exact intervening whitespace', () => {
    const source = String.raw`Before.

\begin{figure}A\end{figure}

  \begin{table}B\end{table}

After.`;
    const projection = importLatex(source);
    expect(projection.doc.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'opaqueBlock',
      'paragraph',
    ]);
    const opaque = projection.doc.content![1];
    expect(opaque.attrs?.raw).toBe(String.raw`\begin{figure}A\end{figure}

  \begin{table}B\end{table}`);
    const changed = clone(projection.doc);
    findText(changed, 'Before')!.text = 'Changed.';
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Before.', 'Changed.'));
    const range = projection.ranges[String(opaque.attrs?.sourceId)];
    const sourceDraft = String.raw`\begin{figure}Updated\end{figure}

  \begin{table}B\end{table}`;
    const afterSourceEdit = source.slice(0, range.from) + sourceDraft + source.slice(range.to);
    const reimported = importLatex(afterSourceEdit);
    expect(reimported.doc.content![1].attrs?.raw).toBe(sourceDraft);
    const noop = projectChanges(reimported, clone(reimported.doc));
    expect(noop.ok).toBe(true);
    if (noop.ok) expect(noop.edits).toEqual([]);
  });
  it('imports without changing source, preserves setup and renders common constructs', () => {
    const projection = importLatex(fixture);
    expect(projection.source).toBe(fixture);
    expect(projection.doc.content?.map((node) => node.type)).toEqual([
      'opaqueBlock',
      'heading',
      'paragraph',
      'opaqueBlock',
      'bulletList',
    ]);
    expect(projection.doc.content?.[1].attrs).toMatchObject({
      latexCommand: 'section',
      starred: true,
      optionalTitle: '[Short]',
    });
    expect(JSON.stringify(projection.doc)).toContain('source');
    const result = projectChanges(projection, clone(projection.doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.edits).toEqual([]);
  });
  it('writes localized prose edits, escapes special characters, and preserves comments and unknown source', () => {
    const projection = importLatex(fixture);
    const changed = clone(projection.doc);
    const text = findText(changed, 'Revenue grew');
    expect(text).toBeDefined();
    text!.text = text!.text!.replace('Revenue grew 50', 'Revenue grew 75% & 50');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = apply(fixture, result.edits);
    expect(updated).toContain(String.raw`Revenue grew 75\% \& 50\%`);
    expect(updated).toContain('% note\n');
    expect(updated).toContain(String.raw`\begin{figure}
\includegraphics{plot.pdf}
\end{figure}`);
    expect(updated).toContain(String.raw`\section*[Short]{Hello \textbf{world}}`);
    expect(result.nextProjection.source).toBe(updated);
  });
  it('rejects deleting opaque source or changing opaque raw bytes', () => {
    const projection = importLatex(String.raw`Hello \cite{keep} world.`);
    const changed = clone(projection.doc);
    const para = changed.content![0];
    para.content = para.content!.filter((node) => node.type !== 'opaqueInline');
    expect(projectChanges(projection, changed).ok).toBe(false);
  });
  it('keeps unchanged source after two edits without reparsing', () => {
    const projection = importLatex('Alpha.\n\nBeta.\n\nGamma.');
    const first = clone(projection.doc);
    findText(first, 'Beta')!.text = 'Beta!';
    const change = projectChanges(projection, first);
    expect(change.ok).toBe(true);
    if (!change.ok) return;
    const second = clone(change.nextProjection.doc);
    findText(second, 'Beta')!.text = 'Beta!!';
    const again = projectChanges(change.nextProjection, second);
    expect(again.ok).toBe(true);
    if (again.ok)
      expect(apply(change.nextProjection.source, again.edits)).toBe('Alpha.\n\nBeta!!\n\nGamma.');
  });
  it('maps ordinary Unicode positions using UTF-16 source offsets', () => {
    const projection = importLatex('Hello 🐈 cat');
    const id = projection.blocks[0].id;
    expect(sourceOffsetForPosition(projection, id, 8)).toBe(8);
  });
  it('keeps active TeX punctuation exact when neighboring prose is edited', () => {
    const source = "Start A~B -- ``quoted'' and \\textbf{before \\cite{key} after} end.";
    const projection = importLatex(source);
    const changed = clone(projection.doc);
    const start = findText(changed, 'Start')!;
    start.text = start.text!.replace('Start', 'Changed');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const output = apply(source, result.edits);
      expect(output).toContain("A~B -- ``quoted''");
      expect(output).toContain(String.raw`\textbf{before \cite{key} after}`);
    }
  });
  it('produces multiple UTF-16 edits for separated changes in one block', () => {
    const source = 'One 🐈 two three.';
    const projection = importLatex(source);
    const changed = clone(projection.doc);
    findText(changed, 'One')!.text = 'First 🐈 two last.';
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.edits.length).toBeGreaterThan(1);
      expect(apply(source, result.edits)).toBe('First 🐈 two last.');
    }
  });
  it('inserts into an empty document body and prevents moving text before the preamble', () => {
    const source = '\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n';
    const projection = importLatex(source);
    expect(projection.doc.content?.map((node) => node.type)).toEqual(['opaqueBlock', 'paragraph']);
    const changed = clone(projection.doc);
    changed.content![1].content = [{ type: 'text', text: 'Hello' }];
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(apply(source, result.edits)).toBe(
        '\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n',
      );
    const beforeSetup = clone(changed);
    beforeSetup.content!.unshift({
      type: 'paragraph',
      attrs: { sourceId: 'new' },
      content: [{ type: 'text', text: 'Outside' }],
    });
    expect(projectChanges(projection, beforeSetup).ok).toBe(false);
    const empty = importLatex('');
    const typed = clone(empty.doc);
    typed.content![0].content = [{ type: 'text', text: 'New' }];
    const fragment = projectChanges(empty, typed);
    expect(fragment.ok).toBe(true);
    if (fragment.ok) expect(apply('', fragment.edits)).toBe('New');
  });
  it('renders nested lists and quotes without losing their raw source on unrelated edits', () => {
    const source = String.raw`Before.

\begin{quote}
Quoted.
\end{quote}

\begin{itemize}
\item Outer
\begin{enumerate}
\item Inner
\end{enumerate}
\end{itemize}`;
    const projection = importLatex(source);
    expect(projection.doc.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'blockquote',
      'bulletList',
    ]);
    expect(JSON.stringify(projection.doc)).toContain('orderedList');
    const changed = clone(projection.doc);
    findText(changed, 'Before')!.text = 'After.';
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Before.', 'After.'));
  });
  it('preserves untouched list items, nested lists, and surrounding whitespace when editing an item', () => {
    const source = String.raw`\begin{itemize}
  \item First

    \item \textit{Second}
    \begin{enumerate}
       \item Nested
    \end{enumerate}
\end{itemize}`;
    const projection = importLatex(source);
    const changed = clone(projection.doc);
    findText(changed, 'First')!.text = 'Updated';
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('First', 'Updated'));
  });
  it('preserves untouched quote paragraphs and separator whitespace', () => {
    const source = String.raw`\begin{quotation}
    First paragraph.


    Second \textbf{paragraph}.
\end{quotation}`;
    const projection = importLatex(source);
    const changed = clone(projection.doc);
    findText(changed, 'First')!.text = 'Changed paragraph.';
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(apply(source, result.edits)).toBe(
        source.replace('First paragraph.', 'Changed paragraph.'),
      );
  });
  it('protects custom macro arguments separated by whitespace and their ambiguous continuation', () => {
    const source = String.raw`Editable before \custom   {first} [option] {second} remaining text.

Next paragraph.`;
    const projection = importLatex(source);
    const paragraph = projection.doc.content![0];
    expect(paragraph.type).toBe('paragraph');
    const atom = paragraph.content!.find((node) => node.type === 'opaqueInline');
    expect(atom?.attrs?.raw).toBe(String.raw`\custom   {first} [option] {second} remaining text.`);
    const changed = clone(projection.doc);
    const text = findText(changed, 'Editable')!;
    text.text = text.text!.replace('Editable', 'Changed');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Editable', 'Changed'));
  });
  it('maps the caret past complete escaped control words and their empty groups', () => {
    for (const command of ['textbackslash', 'textasciitilde', 'textasciicircum']) {
      const source = `A \\${command}{} B`;
      const projection = importLatex(source);
      const id = projection.blocks[0].id;
      expect(sourceOffsetForPosition(projection, id, 3)).toBe(source.indexOf('}') + 1);
    }
  });
  it('keeps known citation arguments together even with whitespace before arguments', () => {
    const projection = importLatex(String.raw`Before \cite [see] {key} after.`);
    const nodes = projection.doc.content![0].content!;
    expect(nodes.find((node) => node.type === 'opaqueInline')?.attrs?.raw).toBe(
      String.raw`\cite [see] {key}`,
    );
    expect(findText(projection.doc, 'after')).toBeDefined();
  });
  it('renders simple equation environments while retaining their exact delimiters', () => {
    const source = String.raw`Before.

\begin{equation*}
x^2 + y^2
\end{equation*}

After.`;
    const projection = importLatex(source);
    const equation = projection.doc.content![1];
    expect(equation.type).toBe('blockMath');
    expect(equation.attrs).toMatchObject({
      open: String.raw`\begin{equation*}`,
      close: String.raw`\end{equation*}`,
      latex: '\nx^2 + y^2\n',
    });
    const doc = clone(projection.doc);
    findText(doc, 'Before')!.text = 'Changed.';
    const result = projectChanges(projection, doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Before.', 'Changed.'));
    const labelled = importLatex(String.raw`\begin{equation} x \label{eq:x} \end{equation}`);
    expect(labelled.doc.content![0].type).toBe('blockMath');
    expect(labelled.doc.content![0].attrs?.renderLatex).not.toContain(String.raw`\label`);
  });
});
