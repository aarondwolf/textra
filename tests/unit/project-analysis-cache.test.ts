import { describe, expect, it, vi } from 'vitest';
import { buildFileIndex } from '../../src/shared/tex-structure';
import { analyzeLatexDocument } from '../../src/shared/writing-analysis';
import { parseBibliography } from '../../src/shared/bibliography';
import {
  indexProjectSources,
  ProjectAnalysisCache,
} from '../../src/renderer/src/features/writing/project-analysis-cache';

describe('incremental project analysis', () => {
  it('parses only changed content, retains unchanged objects, and prunes removed sources', () => {
    const analyze = vi.fn(analyzeLatexDocument);
    const bibliography = vi.fn(parseBibliography);
    const cache = new ProjectAnalysisCache(analyze, bibliography);
    const sources = {
      'main.tex': '\\section{Hello}',
      'chapter.tex': 'Chapter',
      'refs.bib': '@book{sample, title={A title}}',
    };
    const index = buildFileIndex(Object.keys(sources));
    cache.update(sources);
    const first = cache.snapshot('main.tex', index, true);
    cache.update({ ...sources });
    expect(cache.snapshot('main.tex', index, true).documentAnalysis).toBe(first.documentAnalysis);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(bibliography).toHaveBeenCalledTimes(1);
    cache.update({ ...sources, 'chapter.tex': 'Changed chapter' });
    expect(analyze).toHaveBeenCalledTimes(3);
    expect(bibliography).toHaveBeenCalledTimes(1);
    cache.update({ 'main.tex': sources['main.tex'] });
    expect(cache.snapshot('chapter.tex', index, true).documentAnalysis).toBeNull();
    expect(cache.snapshot('main.tex', index, true).bibliographyEntries).toEqual([]);
  });

  it('finds cross-file labels and displays only the active document occurrences', () => {
    const cache = new ProjectAnalysisCache();
    cache.update({
      'main.tex': '\\ref{chapter} \\ref{absent}',
      'chapter.tex': '\\label{chapter} \\ref{other}',
    });
    const diagnostics = cache.snapshot('main.tex', buildFileIndex([]), true).referenceDiagnostics;
    expect(diagnostics.map((item) => item.message)).toEqual(['Missing label: absent']);
    expect(diagnostics.every((item) => item.file === 'main.tex')).toBe(true);
    expect(
      cache.snapshot('main.tex', buildFileIndex([]), true, false).referenceDiagnostics,
    ).toEqual([]);
  });

  it('waits for a complete tree before reporting missing graphics and resolves source-relative graphics', () => {
    const cache = new ProjectAnalysisCache();
    cache.update({ 'chapters/main.tex': '\\includegraphics{figure} \\includegraphics{missing}' });
    const index = buildFileIndex(['chapters/main.tex', 'chapters/figure.pdf']);
    expect(cache.snapshot('chapters/main.tex', index, false).referenceDiagnostics).toEqual([]);
    expect(
      cache
        .snapshot('chapters/main.tex', index, true)
        .referenceDiagnostics.map((item) => item.message),
    ).toEqual(['Missing graphic: missing']);
  });

  it('prioritizes the active source and its dependencies, bounds reads to four and yields between batches', async () => {
    const paths = [
      ...Array.from({ length: 20 }, (_, i) => `other-${i}.tex`),
      'main.tex',
      'chapter.tex',
    ];
    let active = 0;
    let maximum = 0;
    const order: string[] = [];
    const yieldBatch = vi.fn(async () => undefined);
    const onBatch = vi.fn();
    const result = await indexProjectSources({
      paths,
      activePath: 'main.tex',
      index: buildFileIndex(paths),
      initialSources: { 'main.tex': '\\input{chapter}' },
      limit: 9,
      read: async (path) => {
        order.push(path);
        maximum = Math.max(maximum, ++active);
        await Promise.resolve();
        active--;
        return path === 'main.tex' ? '\\input{chapter}' : path;
      },
      cancelled: () => false,
      onBatch,
      yieldBatch,
    });
    expect(order.slice(0, 2)).toEqual(['main.tex', 'chapter.tex']);
    expect(order).toHaveLength(9);
    expect(maximum).toBe(4);
    expect(yieldBatch).toHaveBeenCalledTimes(3);
    expect(onBatch).toHaveBeenCalledTimes(3);
    expect(result.complete).toBe(false);
  });

  it('discovers referenced sources in unloaded folders without revisiting cycles', async () => {
    const sources: Record<string, string> = {
      'main.tex': '\\input{chapters/one}\\bibliography{data/refs}',
      'chapters/one.tex': '\\section{One}\\input{main}',
      'data/refs.bib': '@book{example,title={Example}}',
    };
    const read = vi.fn(async (path: string) => sources[path] ?? null);
    const batches: Record<string, string> = {};
    await indexProjectSources({
      paths: ['main.tex'],
      activePath: 'main.tex',
      index: buildFileIndex(['main.tex']),
      initialSources: { 'main.tex': sources['main.tex'] },
      discoverReferences: true,
      read,
      cancelled: () => false,
      onBatch: (batch) => Object.assign(batches, batch),
      yieldBatch: async () => undefined,
    });
    expect(batches).toEqual(sources);
    expect(
      read.mock.calls.map(([path]) => path).filter((path) => path === 'main.tex'),
    ).toHaveLength(1);
  });

  it('does not publish a completed read batch after cancellation and tolerates unreadable files', async () => {
    let cancelled = false;
    const onBatch = vi.fn();
    const common = {
      paths: ['main.tex'],
      activePath: 'main.tex',
      index: buildFileIndex(['main.tex']),
      initialSources: {},
      onBatch,
      yieldBatch: async () => undefined,
    };
    expect(
      (
        await indexProjectSources({
          ...common,
          cancelled: () => cancelled,
          read: async () => {
            cancelled = true;
            return 'old workspace';
          },
        })
      ).complete,
    ).toBe(false);
    expect(onBatch).not.toHaveBeenCalled();
    cancelled = false;
    expect(
      (
        await indexProjectSources({
          ...common,
          cancelled: () => false,
          read: async () => {
            throw Error('unreadable');
          },
        })
      ).complete,
    ).toBe(false);
    expect(onBatch).toHaveBeenCalledWith({});
  });
});
