import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistorySnapshotSummary } from '../../../../shared/api';

/** Pagination and completion ownership belong to the selected project/document pair. */
export function useHistorySnapshots(projectId: string | null, path: string | null) {
  const [snapshots, setSnapshots] = useState<HistorySnapshotSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef({ value: 0 });
  const scope = useRef('');
  scope.current = `${projectId}\0${path}`;
  const loadSnapshots = useCallback(
    async (cursor?: string) => {
      const id = ++generation.current.value;
      const selected = `${projectId}\0${path}`;
      if (!cursor) {
        setSnapshots([]);
        setNextCursor(null);
      }
      if (!projectId || !path) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const result = await window.textra.listFileHistory({
          projectId,
          path,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        if (id !== generation.current.value || scope.current !== selected) return;
        if (!result.ok) throw new Error(result.error);
        setSnapshots((previous) =>
          cursor
            ? [
                ...new Map(
                  [...previous, ...result.value.snapshots].map((snapshot) => [
                    snapshot.id,
                    snapshot,
                  ]),
                ).values(),
              ]
            : result.value.snapshots,
        );
        setNextCursor(result.value.nextCursor);
      } catch (cause) {
        if (id === generation.current.value && scope.current === selected)
          setError(cause instanceof Error ? cause.message : 'Could not load file history.');
      } finally {
        if (id === generation.current.value && scope.current === selected) setLoading(false);
      }
    },
    [projectId, path],
  );
  useEffect(() => {
    const owner = generation.current;
    void loadSnapshots();
    return () => {
      owner.value++;
    };
  }, [loadSnapshots]);
  return { snapshots, nextCursor, loading, error, loadSnapshots };
}
