import { parseBibliography, type BibliographyEntry } from '../../../../shared/bibliography';
import {
  parseTexStructure,
  resolveReference,
  type FileIndex,
  type TexStructure,
} from '../../../../shared/tex-structure';
import {
  analyzeLatexDocument,
  findReferenceIssues,
  type SourceOccurrence,
  type WritingAnalysis,
} from '../../../../shared/writing-analysis';
import type { ProblemDiagnostic } from '../problems/ProblemsPanel';

interface CachedSource {
  content: string;
  analysis: WritingAnalysis | null;
  bibliography: BibliographyEntry[];
  structure: TexStructure | null;
}

/** Workspace-local content cache. Unchanged files retain their parsed objects. */
export class ProjectAnalysisCache {
  private readonly entries = new Map<string, CachedSource>();
  constructor(
    private readonly analyze = analyzeLatexDocument,
    private readonly bibliography = parseBibliography,
  ) {}

  update(sources: Readonly<Record<string, string>>): void {
    for (const path of this.entries.keys()) if (!(path in sources)) this.entries.delete(path);
    for (const [path, content] of Object.entries(sources)) {
      if (this.entries.get(path)?.content === content) continue;
      const tex = /\.tex$/i.test(path);
      this.entries.set(path, {
        content,
        analysis: tex ? this.analyze(content) : null,
        bibliography: /\.bib$/i.test(path) ? this.bibliography(content) : [],
        structure: tex ? parseTexStructure(content) : null,
      });
    }
  }

  snapshot(
    activePath: string | null,
    index: FileIndex,
    listingComplete: boolean,
    sourcesComplete = true,
  ) {
    const labels: Array<SourceOccurrence & { file: string }> = [];
    const references: Array<SourceOccurrence & { file: string }> = [];
    const bibliographyEntries: BibliographyEntry[] = [];
    const referenceDiagnostics: ProblemDiagnostic[] = [];
    for (const [file, entry] of this.entries) {
      bibliographyEntries.push(...entry.bibliography);
      if (!entry.analysis) continue;
      labels.push(...entry.analysis.labels.map((item) => ({ ...item, file })));
      if (activePath && file !== activePath) continue;
      references.push(...entry.analysis.references.map((item) => ({ ...item, file })));
      if (!listingComplete) continue;
      for (const graphic of entry.analysis.graphics) {
        const found = resolveReference(
          {
            kind: 'graphic',
            command: graphic.command,
            target: graphic.value.replace(/^\{+|\}+$/g, ''),
            line: graphic.line,
          },
          file,
          index,
          entry.structure?.graphicsPaths,
        );
        if (!found)
          referenceDiagnostics.push({
            severity: 'warning',
            source: 'reference',
            code: 'missing-graphic',
            message: `Missing graphic: ${graphic.value}`,
            file,
            line: graphic.line,
            column: graphic.column,
          });
      }
    }
    for (const issue of findReferenceIssues(labels, references)) {
      // An unread or omitted chapter may contain the target label.
      if (issue.kind === 'missing-label' && !sourcesComplete) continue;
      for (const occurrence of issue.occurrences as Array<SourceOccurrence & { file: string }>) {
        if (activePath && occurrence.file !== activePath) continue;
        referenceDiagnostics.push({
          severity: 'warning',
          source: 'reference',
          code: issue.kind,
          message: `${issue.kind === 'duplicate-label' ? 'Duplicate' : 'Missing'} label: ${issue.value}`,
          file: occurrence.file,
          line: occurrence.line,
          column: occurrence.column,
        });
      }
    }
    return {
      documentAnalysis: activePath ? (this.entries.get(activePath)?.analysis ?? null) : null,
      bibliographyEntries,
      referenceDiagnostics,
    };
  }
}

interface IndexOptions {
  paths: readonly string[];
  activePath: string | null;
  index: FileIndex;
  initialSources: Readonly<Record<string, string>>;
  read: (path: string) => Promise<string | null>;
  cancelled: () => boolean;
  onBatch: (sources: Record<string, string>) => void;
  yieldBatch: () => Promise<void>;
  limit?: number;
}

/** Four reads per yielded batch, with active-document dependencies ahead of unrelated files. */
export async function indexProjectSources(options: IndexOptions): Promise<{ complete: boolean }> {
  const remaining = new Set(options.paths);
  const priority: string[] = [];
  const prioritize = (path: string) => {
    if (remaining.has(path) && !priority.includes(path)) priority.push(path);
  };
  const dependencies = (path: string, source: string) => {
    if (!/\.tex$/i.test(path)) return;
    const structure = parseTexStructure(source);
    for (const ref of structure.references) {
      if (ref.kind !== 'tex' && ref.kind !== 'bib') continue;
      const resolved = resolveReference(ref, path, options.index, structure.graphicsPaths);
      if (resolved) prioritize(resolved);
    }
  };
  if (options.activePath) {
    prioritize(options.activePath);
    const source = options.initialSources[options.activePath];
    if (source !== undefined) dependencies(options.activePath, source);
  }
  let reads = 0;
  let failed = false;
  while (remaining.size && reads < (options.limit ?? 250) && !options.cancelled()) {
    const batch: string[] = [];
    while (batch.length < 4 && remaining.size && reads < (options.limit ?? 250)) {
      const path = priority.shift() ?? remaining.values().next().value;
      if (!path || !remaining.delete(path)) continue;
      batch.push(path);
      reads++;
    }
    const values = await Promise.all(
      batch.map(async (path) => {
        try {
          return [path, await options.read(path)] as const;
        } catch {
          return [path, null] as const;
        }
      }),
    );
    if (options.cancelled()) return { complete: false };
    const sources: Record<string, string> = {};
    for (const [path, source] of values) {
      if (source === null) {
        failed = true;
        continue;
      }
      sources[path] = source;
      dependencies(path, source);
    }
    if (values.length) options.onBatch(sources);
    await options.yieldBatch();
  }
  return { complete: remaining.size === 0 && !failed && !options.cancelled() };
}
