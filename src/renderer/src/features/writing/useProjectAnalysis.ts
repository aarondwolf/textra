import { useEffect, useMemo, useState } from 'react';
import type { ProjectInfo } from '../../../../shared/api';
import { buildFileIndex } from '../../../../shared/tex-structure';
import type { OpenDocument } from '../../state/workspace';
import { indexProjectSources, ProjectAnalysisCache } from './project-analysis-cache';

const EMPTY_SOURCES: Record<string, string> = {};

export function useProjectAnalysis(
  project: ProjectInfo | null,
  documents: OpenDocument[],
  activePath: string | null,
  enabled: boolean,
) {
  const projectId = project?.id ?? null;
  const files = project?.files;
  const listingComplete = !!project && project.treeState !== 'loading' && !project.truncated;
  const knownFiles = useMemo(
    () => new Set(files?.filter((file) => file.kind === 'file').map((file) => file.path)),
    [files],
  );
  const index = useMemo(() => buildFileIndex(knownFiles), [knownFiles]);
  // Each project token owns an isolated cache, including when two roots share file names.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cache = useMemo(() => new ProjectAnalysisCache(), [projectId]);
  const [disk, setDisk] = useState<{
    projectId: string | null;
    sources: Record<string, string>;
    complete: boolean;
  }>({ projectId: null, sources: {}, complete: false });
  const [parsed, setParsed] = useState<{
    cache: ProjectAnalysisCache;
    revision: number;
    complete: boolean;
  } | null>(null);
  const diskSources = disk.projectId === projectId ? disk.sources : EMPTY_SOURCES;
  const analysisSources = useMemo(() => {
    const sources = { ...diskSources };
    if (listingComplete)
      for (const path of Object.keys(sources)) if (!knownFiles.has(path)) delete sources[path];
    for (const document of documents) {
      if (document.projectId === projectId && /\.(?:tex|bib|md)$/i.test(document.path))
        sources[document.path] = document.content;
    }
    return sources;
  }, [diskSources, documents, knownFiles, listingComplete, projectId]);

  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    const initialSources = Object.fromEntries(
      documents
        .filter(
          (document) =>
            document.projectId === projectId && /\.(?:tex|bib|md)$/i.test(document.path),
        )
        .map((document) => [document.path, document.content]),
    );
    const paths =
      files
        ?.filter((file) => file.kind === 'file' && /\.(?:tex|bib|md)$/i.test(file.path))
        .map((file) => file.path) ?? [];
    setDisk((previous) => ({
      projectId,
      complete: false,
      sources:
        previous.projectId === projectId
          ? Object.fromEntries(
              Object.entries(previous.sources).filter(([path]) => paths.includes(path)),
            )
          : {},
    }));
    void indexProjectSources({
      paths,
      activePath,
      index,
      initialSources,
      read: async (path) => {
        const result = await window.textra.readFile({ projectId, path });
        return result.ok ? result.value.content : null;
      },
      cancelled: () => cancelled,
      onBatch: (sources) =>
        setDisk((previous) =>
          cancelled
            ? previous
            : {
                projectId,
                sources: {
                  ...(previous.projectId === projectId ? previous.sources : {}),
                  ...sources,
                },
                complete: false,
              },
        ),
      yieldBatch: () => new Promise((resolve) => setTimeout(resolve, 0)),
    }).then(({ complete }) => {
      if (!cancelled)
        setDisk((previous) =>
          previous.projectId === projectId ? { ...previous, complete } : previous,
        );
    });
    return () => {
      cancelled = true;
    };
    // Open buffers are captured once for priority. Typing never restarts disk indexing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, files, index]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      cache.update(analysisSources);
      setParsed((previous) => ({
        cache,
        revision: (previous?.revision ?? 0) + 1,
        complete: listingComplete && disk.projectId === projectId && disk.complete,
      }));
    }, 300);
    return () => clearTimeout(timer);
  }, [analysisSources, cache, enabled, listingComplete, disk.projectId, disk.complete, projectId]);

  const result = useMemo(
    () =>
      cache.snapshot(
        activePath,
        index,
        listingComplete,
        listingComplete &&
          disk.projectId === projectId &&
          disk.complete &&
          parsed?.cache === cache &&
          parsed.complete,
      ),
    [cache, parsed, activePath, index, listingComplete, disk.projectId, disk.complete, projectId],
  );
  return { analysisSources, ...result };
}
