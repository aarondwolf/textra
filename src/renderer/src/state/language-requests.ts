import { useWorkspace } from './workspace';

interface RequestOwner {
  projectId: string;
  requestId: string;
}
const requests = new Map<string, RequestOwner>();
function cancel(owner: RequestOwner): void {
  void window.textra.cancelLanguageRequest({ requestId: owner.requestId }).catch(() => undefined);
}
useWorkspace.subscribe((state) => {
  for (const [key, owner] of requests) {
    if (owner.projectId === state.project?.id) continue;
    requests.delete(key);
    cancel(owner);
  }
});

/** A superseded tool request is cancelled in main, not merely ignored in the renderer. */
export async function runLanguageRequest<T>(
  projectId: string,
  path: string,
  kind: 'lint' | 'format',
  invoke: (requestId: string) => Promise<T>,
): Promise<T | null> {
  const key = `${projectId}\0${path}\0${kind}`;
  const previous = requests.get(key);
  if (previous) cancel(previous);
  const owner = { projectId, requestId: crypto.randomUUID() };
  requests.set(key, owner);
  try {
    const result = await invoke(owner.requestId);
    return requests.get(key) === owner && useWorkspace.getState().project?.id === projectId
      ? result
      : null;
  } finally {
    if (requests.get(key) === owner) requests.delete(key);
  }
}
