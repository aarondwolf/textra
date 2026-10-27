import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectInfo } from '../../../../shared/api';
import { includeProjectFile, mergeProjectDirectory } from '../../../../shared/project-tree';
import { useWorkspace } from '../../state/workspace';

export function useDirectoryListing(project: ProjectInfo | null, expanded: Set<string>) {
  const projectId = project?.id;
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  useEffect(() => {
    pending.current = new Set();
    setLoading({});
    setErrors({});
  }, [projectId]);
  const keyFor = (path: string) => `${projectId}:${path}`;
  const load = useCallback(
    async (path: string, more = false) => {
      const current = useWorkspace.getState().project;
      if (!current || current.id !== projectId) return;
      const key = `${current.id}:${path}`;
      if (pending.current.has(key)) return;
      const offset = more ? current.directoryPages?.[path] : 0;
      if (offset === null) return;
      pending.current.add(key);
      setLoading((previous) => ({ ...previous, [key]: true }));
      setErrors((previous) => ({ ...previous, [key]: '' }));
      try {
        const result = await window.textra.listProjectDirectory({
          projectId: current.id,
          path,
          offset: offset ?? 0,
        });
        if (!result.ok) throw new Error(result.error);
        useWorkspace.setState((state) =>
          state.project?.id === current.id && state.project.listingId === current.listingId
            ? { project: mergeProjectDirectory(state.project, result.value) }
            : {},
        );
      } catch (error) {
        setErrors((previous) => ({
          ...previous,
          [key]: error instanceof Error ? error.message : 'Could not load this folder.',
        }));
      } finally {
        pending.current.delete(key);
        setLoading((previous) => ({ ...previous, [key]: false }));
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (!project?.directoryPages) return;
    for (const path of expanded) {
      if (pending.current.size >= 4) break;
      const key = `${project.id}:${path}`;
      if (!Object.hasOwn(project.directoryPages, path) && !loading[key] && !errors[key])
        void load(path);
    }
  }, [project, expanded, loading, errors, load]);

  // Restored tabs and direct source navigation may refer to folders beyond the first page.
  useEffect(() => {
    if (!project) return;
    const state = useWorkspace.getState();
    if (state.project?.id !== project.id) return;
    let next = project;
    for (const document of state.documents) next = includeProjectFile(next, document.path);
    if (next !== project) useWorkspace.setState({ project: next });
  }, [project]);

  return {
    load,
    loading: (path: string) => Boolean(loading[keyFor(path)]),
    error: (path: string) => errors[keyFor(path)] ?? '',
  };
}
