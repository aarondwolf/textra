import { afterPaint } from './scheduling';
import {
  openDocument,
  setProject,
  useWorkspace,
  beginRestoration,
  restorationIsCurrent,
} from '../../state/workspace';
import { useStartup } from '../../state/startup';

const KEY = 'textra:workspace-session';
export interface WorkspaceSession {
  version: 1;
  recentId: string;
  paths: string[];
  activePath: string | null;
}

function safePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/^[\\/]|^[a-z]:|\0/i.test(value) &&
    !value.split(/[\\/]/).some((part) => part === '..')
  );
}

/** Read the legacy unversioned shape too, without accepting arbitrary storage paths. */
export function parseWorkspaceSession(raw: string | null): WorkspaceSession | null {
  if (!raw || raw.length > 256_000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const saved = value as Record<string, unknown>;
    if (saved.version !== undefined && saved.version !== 1) return null;
    const recentId = saved.recentId ?? saved.projectId;
    if (typeof recentId !== 'string' || recentId.length > 256 || !Array.isArray(saved.paths))
      return null;
    const paths = [...new Set(saved.paths.filter(safePath))].slice(0, 50);
    const activePath = safePath(saved.activePath) ? saved.activePath : null;
    return { version: 1, recentId, paths, activePath };
  } catch {
    return null;
  }
}

let restoring: Promise<void> | undefined;
/** Single-flight survives StrictMode's effect replay. Explicit actions cancel through the store. */
export function restoreWorkspaceSession(): Promise<void> {
  restoring ??= restore();
  return restoring;
}

async function restore(): Promise<void> {
  const generation = beginRestoration();
  useStartup.setState({ restoration: 'restoring' });
  try {
    const saved = parseWorkspaceSession(window.localStorage.getItem(KEY));
    if (!saved) return;
    const recent = await window.textra.getRecentProjects();
    if (!restorationIsCurrent(generation) || !recent.ok) return;
    if (!recent.value.some((entry) => entry.id === saved.recentId)) return;
    const opened = await window.textra.openRecentProject(saved.recentId);
    if (!restorationIsCurrent(generation) || !opened.ok || !opened.value) return;
    const project = opened.value;
    const settings = setProject(project, { restoring: true });
    const paths = [
      ...new Set([...(saved.activePath ? [saved.activePath] : []), ...saved.paths]),
    ].slice(0, 50);
    // Only this read selects a tab. Remaining reads cannot steal focus or overwrite edits.
    let selected = false;
    const attempted = new Set<string>();
    for (const path of paths) {
      if (!restorationIsCurrent(generation)) return;
      attempted.add(path);
      await openDocument(path, undefined, { restoring: true, background: selected, quiet: true });
      selected ||= useWorkspace.getState().activePath !== null;
      if (selected) break;
    }
    await afterPaint();
    for (const path of paths) {
      if (!restorationIsCurrent(generation)) return;
      if (attempted.has(path)) continue;
      if (useWorkspace.getState().documents.some((document) => document.path === path)) continue;
      await openDocument(path, undefined, { restoring: true, background: true, quiet: true });
      await afterPaint();
    }
    await settings;
    if (!restorationIsCurrent(generation)) return;
    useWorkspace.setState((state) => ({
      documents: [...state.documents].sort((a, b) => {
        const order = saved.paths;
        return (
          (order.includes(a.path) ? order.indexOf(a.path) : order.length) -
          (order.includes(b.path) ? order.indexOf(b.path) : order.length)
        );
      }),
    }));
    if (paths.length !== useWorkspace.getState().documents.length)
      useWorkspace.setState({
        error: 'Some previous tabs are unavailable. Available files were restored.',
      });
  } catch {
    // Keep malformed/unavailable metadata intact. The project chooser remains usable.
  } finally {
    if (restorationIsCurrent(generation)) useStartup.setState({ restoration: 'settled' });
  }
}

export function persistWorkspaceSession(enabled: boolean): void {
  if (!enabled || useStartup.getState().restoration !== 'settled') return;
  const { project, recents, documents, activePath } = useWorkspace.getState();
  const recent = recents.find((item) => item.rootPath === project?.rootPath);
  if (!project || !recent) return;
  const saved: WorkspaceSession = {
    version: 1,
    recentId: recent.id,
    paths: documents.map((item) => item.path),
    activePath,
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* Storage failure cannot block editing. */
  }
}
