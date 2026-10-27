import { describe, expect, it } from 'vitest';
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

describe('visual LaTeX adapter', () => {
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
    const atom = projection.doc.content![0];
    expect(atom.type).toBe('opaqueBlock');
    expect(atom.attrs?.raw).toBe(
      String.raw`Editable before \custom   {first} [option] {second} remaining text.`,
    );
    const changed = clone(projection.doc);
    const text = findText(changed, 'Next')!;
    text.text = text.text!.replace('Next', 'Changed');
    const result = projectChanges(projection, changed);
    expect(result.ok).toBe(true);
    if (result.ok) expect(apply(source, result.edits)).toBe(source.replace('Next', 'Changed'));
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
    const unsupported = importLatex(String.raw`\begin{equation} x \label{eq:x} \end{equation}`);
    expect(unsupported.doc.content![0].type).toBe('opaqueBlock');
  });
});
