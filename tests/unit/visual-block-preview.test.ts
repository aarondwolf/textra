import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  inspectFigure,
  inspectMetadata,
  inspectTable,
  parseTablePreview,
  pdfFigureCandidates,
  resolvePdfFigure,
  splitVisualPreviewBlocks,
} from '../../src/renderer/src/features/visual-editor/visual-block-preview';

describe('visual block previews', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('probes only plausible PDF figure paths', () => {
    expect(pdfFigureCandidates('figs/plot.png', 'chapters/chapter.tex')).toEqual([]);
    expect(pdfFigureCandidates('figs/plot.jpg', 'chapters/chapter.tex')).toEqual([]);
    expect(pdfFigureCandidates('figs/plot.pdf', 'chapters/chapter.tex')).toEqual([
      'figs/plot.pdf',
      'chapters/figs/plot.pdf',
    ]);
    expect(pdfFigureCandidates('figs/plot', 'chapters/chapter.tex')).toEqual([
      'figs/plot.pdf',
      'chapters/figs/plot.pdf',
    ]);
    expect(pdfFigureCandidates('../plot.pdf', 'chapters/chapter.tex')).toEqual(['plot.pdf']);
  });
  it('only advances after missing candidates, and shares concurrent probes without caching misses', async () => {
    const read = vi.fn(async ({ path }: { path: string }) =>
      path === 'missing.pdf'
        ? { ok: false as const, code: 'NOT_FOUND', error: 'Missing' }
        : { ok: true as const, value: new Uint8Array([1]) },
    );
    vi.stubGlobal('window', { textra: { readProjectPdfCandidate: read } });
    const paths = ['missing.pdf', 'chapters/found.pdf'];
    const [first, second] = await Promise.all([
      resolvePdfFigure('project', paths),
      resolvePdfFigure('project', paths),
    ]);
    expect(first).toEqual({ ok: true, value: new Uint8Array([1]) });
    expect(second).toEqual(first);
    expect(read).toHaveBeenCalledTimes(2);
    await resolvePdfFigure('project', ['missing.pdf']);
    expect(read).toHaveBeenCalledTimes(3);
    read.mockResolvedValueOnce({ ok: false, code: 'STALE_PROJECT', error: 'Closed' });
    const stale = await resolvePdfFigure('project', ['stale.pdf', 'must-not-read.pdf']);
    expect(stale).toMatchObject({ ok: false, code: 'STALE_PROJECT' });
    expect(read).toHaveBeenCalledTimes(4);
  });
  it('splits adjacent figures and tables by verified source positions only', () => {
    const first = String.raw`\begin{figure}\includegraphics{one.pdf}\end{figure}`;
    const second = String.raw`\begin{figure}\includegraphics{two.pdf}\end{figure}`;
    const table = String.raw`\begin{tabular}{l} text \\ \end{tabular}`;
    expect(splitVisualPreviewBlocks(`${first}\n\n  ${second}\n${table}`)).toEqual([
      first,
      second,
      table,
    ]);
    expect(splitVisualPreviewBlocks(`${first}\n% comment\n${second}`)).toBeNull();
    expect(splitVisualPreviewBlocks(`${first}\nText\n${second}`)).toBeNull();
    expect(splitVisualPreviewBlocks(first)).toBeNull();
  });
  it('extracts a caption and validated local target without expanding TeX', () => {
    expect(
      inspectFigure(
        String.raw`\begin{figure}\includegraphics[width=2in]{figs/example.pdf}\caption{A \textbf{sample}}\end{figure}`,
      ),
    ).toEqual({ target: 'figs/example.pdf', caption: 'A sample' });
    expect(
      inspectFigure(
        String.raw`\begin{figure}\includegraphics{https://example.com/a.pdf}\end{figure}`,
      ),
    ).toBeNull();
  });
  it('extracts metadata from the document setup', () => {
    expect(
      inspectMetadata(
        String.raw`\documentclass{article}\title{A title}\author{A Person}\date{Today}\begin{document}`,
      ),
    ).toEqual({ title: 'A title', author: 'A Person', date: 'Today' });
  });
  it('previews formatted and mathematical cells, refusing unsupported macros and mismatched columns', () => {
    expect(
      inspectTable(String.raw`\begin{tabular}{lc} One & Two \\ Three & Four \\ \end{tabular}`),
    ).toEqual([
      ['One', 'Two'],
      ['Three', 'Four'],
    ]);
    const rich = parseTablePreview(
      String.raw`\begin{tabular}{lc} \textbf{One} & $x^2$ \\ A\&B & \emph{Two} \\ \end{tabular}`,
    );
    expect(rich).not.toBeNull();
    expect(rich![0][0][0].marks).toEqual([{ type: 'bold' }]);
    expect(rich![0][1][0].type).toBe('inlineMath');
    expect(
      inspectTable(String.raw`\begin{tabular}{lc} A\&B & \emph{Two} \\ \end{tabular}`),
    ).toEqual([['A&B', 'Two']]);
    expect(
      inspectTable(String.raw`\begin{tabular}{lc} \custom{One} & Two \\ \end{tabular}`),
    ).toEqual([[String.raw`\custom{One}`, 'Two']]);
    expect(inspectTable(String.raw`\begin{tabular}{lc} One \\ \end{tabular}`)).toBeNull();
  });
  it('supports conventional rules and limits rows and columns', () => {
    const table = (body: string, columns = 'l') =>
      `\\begin{tabular}{${columns}}${body}\\end{tabular}`;
    expect(inspectTable(table(String.raw`\toprule One \\ \midrule Two \\ \bottomrule`))).toEqual([
      ['One'],
      ['Two'],
    ]);
    expect(
      inspectTable(table(Array.from({ length: 100 }, (_, i) => `${i} \\\\`).join('\n'))),
    ).toHaveLength(100);
    expect(
      inspectTable(table(Array.from({ length: 101 }, (_, i) => `${i} \\\\`).join('\n'))),
    ).toBeNull();
    expect(inspectTable(table('x', 'l'.repeat(21)))).toBeNull();
  });
  it('keeps tables with line comments readable without interpreting comment text as cells', () => {
    const source = String.raw`\begin{tabular}{lc}
One & Two \\ % explanatory note & not a cell
Three & Four \\ % another
\end{tabular}`;
    expect(inspectTable(source)).toEqual([
      ['One', 'Two'],
      ['Three', 'Four'],
    ]);
  });
});
