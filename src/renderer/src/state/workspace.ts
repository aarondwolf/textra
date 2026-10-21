import { create } from 'zustand';
import type {
  BuildEngine,
  BuildState,
  FileSnapshot,
  ProjectInfo,
  ProjectConfig,
  RecentProject,
  SourceLocation,
  ToolInfo,
} from '../../../shared/api';

export interface OpenDocument extends FileSnapshot {
  savedContent: string;
  conflict: boolean;
  /** The last observed external lifecycle state. A conflict always locks ordinary writes. */
  externalState: 'changing' | 'stable' | 'deleted' | 'renamed' | null;
}
export const idleBuild: BuildState = {
  running: false,
  log: '',
  diagnostics: [],
  outcome: 'idle',
  pdfPath: null,
  projectId: null,
  rootFile: null,
};
interface WorkspaceState {
  project: ProjectInfo | null;
  documents: OpenDocument[];
  activePath: string | null;
  recents: RecentProject[];
  tools: ToolInfo[];
  toolsReady: boolean;
  build: BuildState;
  engine: BuildEngine;
  recipes: Record<string, string>;
  projectConfig: ProjectConfig | null;
  rootFile: string;
  error: string | null;
  busy: boolean;
  navigation: SourceLocation | null;
  source: { path: string; line: number } | null;
}
export const useWorkspace = create<WorkspaceState>(() => ({
  project: null,
  documents: [],
  activePath: null,
  recents: [],
  tools: [],
  toolsReady: false,
  build: idleBuild,
  engine: 'pdflatex',
  recipes: {},
  projectConfig: null,
  rootFile: '',
  error: null,
  busy: false,
  navigation: null,
  source: null,
}));
export const dirty = (document: OpenDocument) => document.content !== document.savedContent;
export function showError(error: unknown): void {
  useWorkspace.setState({ error: error instanceof Error ? error.message : String(error) });
}
export async function initializeWorkspace(): Promise<void> {
  const results = await Promise.allSettled([
    window.textra.getRecentProjects(),
    window.textra.detectTools(),
    window.textra.getBuildState(),
  ]);
  const [recents, tools, build] = results;
  if (recents.status === 'fulfilled' && recents.value.ok)
    useWorkspace.setState({ recents: recents.value.value });
  if (tools.status === 'fulfilled' && tools.value.ok)
    useWorkspace.setState({ tools: tools.value.value });
  else if (tools.status === 'rejected') showError(tools.reason);
  else if (!tools.value.ok) showError(tools.value.error);
  if (build.status === 'fulfilled' && build.value.ok)
    useWorkspace.setState({ build: build.value.value });
  useWorkspace.setState({ toolsReady: true });
}
export async function setProject(project: ProjectInfo): Promise<void> {
  useWorkspace.setState({
    project,
    documents: [],
    recipes: {},
    projectConfig: null,
    activePath: null,
    rootFile:
      project.mainFile ?? project.files.find((file) => file.path.endsWith('.tex'))?.path ?? '',
    error: null,
    navigation: null,
    source: null,
  });
  const recents = await window.textra.getRecentProjects();
  if (recents.ok) useWorkspace.setState({ recents: recents.value });
  const config = await window.textra.getProjectConfig(project.id);
  if (useWorkspace.getState().project?.id !== project.id) return;
  if (!config.ok) showError(config.error);
  else {
    const rootExists =
      !config.value.rootFile || project.files.some((file) => file.path === config.value.rootFile);
    useWorkspace.setState({
      engine: config.value.engine,
      projectConfig: config.value,
      recipes:
        config.value.recipes ??
        (config.value.rootFile ? { [config.value.rootFile]: config.value.engine } : {}),
      ...(rootExists && config.value.rootFile ? { rootFile: config.value.rootFile } : {}),
    });
  }
}
export async function openDocument(path: string, location?: SourceLocation): Promise<void> {
  const { project, documents } = useWorkspace.getState();
  if (!project) return;
  if (documents.some((document) => document.path === path)) {
    useWorkspace.setState({ activePath: path, navigation: location ?? null });
    return;
  }
  if (documents.length >= 50) {
    showError('Close a tab before opening more than 50 files.');
    return;
  }
  try {
    const result = await window.textra.readFile({ projectId: project.id, path });
    if (!result.ok) throw new Error(result.error);
    if (useWorkspace.getState().project?.id !== project.id) return;
    useWorkspace.setState((state) => {
      const exists = state.documents.some((document) => document.path === path);
      if (!exists && state.documents.length >= 50)
        return { error: 'Close a tab before opening more than 50 files.' };
      return {
        documents: exists
          ? state.documents
          : [
              ...state.documents,
              {
                ...result.value,
                savedContent: result.value.content,
                conflict: false,
                externalState: null,
              },
            ],
        activePath: path,
        navigation: location ?? null,
        error: null,
      };
    });
  } catch (error) {
    showError(error);
  }
}
export function editDocument(path: string, content: string): void {
  useWorkspace.setState((state) => ({
    documents: state.documents.map((document) =>
      document.path === path ? { ...document, content } : document,
    ),
  }));
}
export function closeDocument(path: string): void {
  useWorkspace.setState((state) => {
    const documents = state.documents.filter((document) => document.path !== path);
    return {
      documents,
      activePath: state.activePath === path ? (documents.at(-1)?.path ?? null) : state.activePath,
    };
  });
}
export function reorderDocuments(fromIndex: number, toIndex: number): void {
  useWorkspace.setState((state) => {
    if (
      fromIndex < 0 ||
      fromIndex >= state.documents.length ||
      toIndex < 0 ||
      toIndex >= state.documents.length ||
      fromIndex === toIndex
    ) {
      return state;
    }
    const documents = [...state.documents];
    const [moved] = documents.splice(fromIndex, 1);
    documents.splice(toIndex, 0, moved);
    return { documents };
  });
}
export async function saveDocument(path: string): Promise<boolean> {
  const document = useWorkspace.getState().documents.find((item) => item.path === path);
  if (!document || !dirty(document)) return true;
  try {
    if (document.conflict)
      throw new Error('The file changed on disk. Reload it or save your edits to a new file.');
    const result = await window.textra.saveFile({
      projectId: document.projectId,
      path,
      content: document.content,
      expectedRevision: document.revision,
    });
    if (!result.ok) {
      if (result.code === 'CONFLICT' || /changed|conflict|revision/i.test(result.error))
        useWorkspace.setState((state) => ({
          documents: state.documents.map((item) =>
            item.path === path ? { ...item, conflict: true, externalState: 'stable' } : item,
          ),
        }));
      throw new Error(result.error);
    }
    useWorkspace.setState((state) => ({
      documents: state.documents.map((item) =>
        item.path === path && item.projectId === document.projectId
          ? {
              ...item,
              revision: result.value.revision,
              savedContent: result.value.content,
              conflict: false,
              externalState: null,
            }
          : item,
      ),
      error: null,
    }));
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
}
export async function saveAll(): Promise<boolean> {
  for (const document of useWorkspace.getState().documents)
    if (!(await saveDocument(document.path))) return false;
  const hasDirty = useWorkspace.getState().documents.some(dirty);
  const result = await window.textra.setDirty(hasDirty);
  if (!result.ok) {
    showError(result.error);
    return false;
  }
  return !hasDirty;
}
export async function discardAll(): Promise<void> {
  useWorkspace.setState((state) => ({
    documents: state.documents.map((document) => ({ ...document, content: document.savedContent })),
  }));
  const result = await window.textra.setDirty(false);
  if (!result.ok) throw new Error(result.error);
}
export async function reloadDocument(path: string): Promise<void> {
  const project = useWorkspace.getState().project;
  const original = useWorkspace.getState().documents.find((document) => document.path === path);
  if (!project) return;
  const result = await window.textra.readFile({ projectId: project.id, path });
  if (useWorkspace.getState().project?.id !== project.id) return;
  if (!result.ok) {
    showError(result.error);
    return;
  }
  useWorkspace.setState((state) => ({
    documents: state.documents.map((document) =>
      document.path === path &&
      document.content === original?.content &&
      document.revision === original.revision
        ? {
            ...result.value,
            savedContent: result.value.content,
            conflict: false,
            externalState: null,
          }
        : document,
    ),
    error: null,
  }));
}
export async function checkExternalChanges(): Promise<void> {
  const { project, documents } = useWorkspace.getState();
  if (!project || !documents.length) return;
  const result = await window.textra.getFileRevisions({
    projectId: project.id,
    paths: documents.map((document) => document.path),
  });
  if (!result.ok || useWorkspace.getState().project?.id !== project.id) return;
  useWorkspace.setState((state) => ({
    documents: state.documents.map((document) => {
      const revision = result.value.find((item) => item.path === document.path);
      const checked = documents.find((item) => item.path === document.path);
      return revision &&
        checked?.revision === document.revision &&
        revision.revision !== document.revision
        ? { ...document, conflict: true, externalState: 'stable' }
        : document;
    }),
  }));
}

/**
 * The watcher and compatibility polling share this one-way transition. Once
 * observed, only an explicit conflict decision may clear the write lock.
 */
export function markExternalChange(path: string, state: OpenDocument['externalState']): void {
  useWorkspace.setState((current) => ({
    documents: current.documents.map((document) =>
      document.path === path ? { ...document, conflict: true, externalState: state } : document,
    ),
  }));
}
