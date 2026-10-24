import { create } from 'zustand';
import { useStartup } from './startup';
import { documentSessions, type DocumentCapture } from './document-sessions';
import type {
  BuildEngine,
  BuildState,
  FileEntry,
  FileSnapshot,
  ProjectInfo,
  ProjectConfig,
  RecentProject,
  SourceLocation,
  ToolInfo,
  Result,
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
  configReady: boolean;
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
  configReady: false,
  rootFile: '',
  error: null,
  busy: false,
  navigation: null,
  source: null,
}));
export const dirty = (document: OpenDocument) => document.content !== document.savedContent;
useWorkspace.subscribe((state, previous) => {
  if (state.documents !== previous.documents) documentSessions.observe(state.documents);
});

/** Approved rewrites must still refer to the same open buffer and version. */
export function replaceDocument(capture: DocumentCapture, content: string): boolean {
  if (documentSessions.locked || !documentSessions.matches(capture)) return false;
  editDocument(capture.path, content);
  return true;
}
export function showError(error: unknown): void {
  useWorkspace.setState({ error: error instanceof Error ? error.message : String(error) });
}
let restorationGeneration = 0;
let selectionGeneration = 0;
const documentReads = new Map<string, Promise<Result<FileSnapshot>>>();
export function beginRestoration(): number {
  return ++restorationGeneration;
}
export function restorationIsCurrent(generation: number): boolean {
  return generation === restorationGeneration;
}
export function sortProjectTexFiles(files: FileEntry[]): FileEntry[] {
  const texFiles = files.filter((entry) => entry.kind === 'file' && /\.tex$/i.test(entry.path));
  const rootFiles = texFiles
    .filter((file) => !file.path.includes('/'))
    .sort((a, b) => a.path.localeCompare(b.path));
  const subfolderFiles = texFiles
    .filter((file) => file.path.includes('/'))
    .sort((a, b) => a.path.localeCompare(b.path));
  return [...rootFiles, ...subfolderFiles];
}

export function cancelWorkspaceRestoration(): void {
  restorationGeneration++;
  useStartup.setState({ restoration: 'settled' });
}
let initialization: Promise<void> | undefined;
export async function initializeWorkspace(): Promise<void> {
  initialization ??= Promise.allSettled([
    window.textra.getRecentProjects().then((result) => {
      if (result.ok) useWorkspace.setState({ recents: result.value });
    }),
    window.textra.getBuildState().then((result) => {
      if (result.ok) useWorkspace.setState({ build: result.value });
    }),
  ]).then(() => undefined);
  return initialization;
}
let detection: Promise<void> | undefined;
export function discoverWorkspaceTools(): Promise<void> {
  detection ??= window.textra
    .detectTools()
    .then((result) => {
      if (result.ok) useWorkspace.setState({ tools: result.value });
      else showError(result.error);
    })
    .catch(showError)
    .finally(() => {
      useWorkspace.setState({ toolsReady: true });
      detection = undefined;
    });
  return detection;
}
export async function setProject(
  project: ProjectInfo,
  options: { restoring?: boolean } = {},
): Promise<void> {
  if (!options.restoring) cancelWorkspaceRestoration();
  selectionGeneration++;
  useStartup.setState({ editorReady: false });
  useWorkspace.setState({
    project,
    documents: [],
    recipes: {},
    projectConfig: null,
    configReady: false,
    activePath: null,
    rootFile:
      project.mainFile ?? project.files.find((file) => file.path.endsWith('.tex'))?.path ?? '',
    error: null,
    navigation: null,
    source: null,
  });
  void window.textra
    .getRecentProjects()
    .then((recents) => {
      if (recents.ok && useWorkspace.getState().project?.id === project.id)
        useWorkspace.setState({ recents: recents.value });
    })
    .catch(() => undefined);
  const config = await window.textra.getProjectConfig(project.id);
  if (useWorkspace.getState().project?.id !== project.id) return;
  useWorkspace.setState({ configReady: true });
  if (!config.ok) showError(config.error);
  else {
    const rootExists =
      project.treeState === 'loading' ||
      !config.value.rootFile ||
      project.files.some((file) => file.path === config.value.rootFile);
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
export async function openDocument(
  path: string,
  location?: SourceLocation,
  options: {
    restoring?: boolean;
    background?: boolean;
    quiet?: boolean;
    replacePath?: string;
  } = {},
): Promise<void> {
  if (!options.restoring) cancelWorkspaceRestoration();
  const restoration = restorationGeneration;
  const selection = options.background ? selectionGeneration : ++selectionGeneration;
  const { project, documents } = useWorkspace.getState();
  if (!project) return;
  if (documents.some((document) => document.path === path)) {
    if (!options.background) {
      const nextDocs =
        options.replacePath && options.replacePath !== path
          ? documents.filter((doc) => doc.path !== options.replacePath || dirty(doc))
          : documents;
      useWorkspace.setState({
        documents: nextDocs,
        activePath: path,
        navigation: location ?? null,
      });
    }
    return;
  }
  if (documents.length >= 50) {
    showError('Close a tab before opening more than 50 files.');
    return;
  }
  try {
    const readKey = `${project.id}\0${path}`;
    let pendingRead = documentReads.get(readKey);
    if (!pendingRead) {
      pendingRead = window.textra
        .readFile({ projectId: project.id, path })
        .finally(() => documentReads.delete(readKey));
      documentReads.set(readKey, pendingRead);
    }
    const result = await pendingRead;
    if (options.restoring && restoration !== restorationGeneration) return;
    if (!result.ok) throw new Error(result.error);
    if (useWorkspace.getState().project?.id !== project.id) return;
    useWorkspace.setState((state) => {
      const exists = state.documents.some((document) => document.path === path);
      if (!exists && state.documents.length >= 50)
        return { error: 'Close a tab before opening more than 50 files.' };
      const newDoc: OpenDocument = {
        ...result.value,
        savedContent: result.value.content,
        conflict: false,
        externalState: null,
      };
      let nextDocs = exists ? state.documents : [...state.documents, newDoc];
      if (options.replacePath && options.replacePath !== path) {
        nextDocs = nextDocs.filter((doc) => doc.path !== options.replacePath || dirty(doc));
      }
      return {
        documents: nextDocs,
        ...(!options.background &&
        (selection === selectionGeneration ||
          !state.documents.some((document) => document.path === state.activePath))
          ? { activePath: path, navigation: location ?? null }
          : {}),
        ...(!options.quiet ? { error: null } : {}),
      };
    });
  } catch (error) {
    if (!options.quiet) showError(error);
  }
}
export function editDocument(path: string, content: string): void {
  if (documentSessions.locked) return;
  useWorkspace.setState((state) => ({
    documents: state.documents.map((document) =>
      document.path === path ? { ...document, content } : document,
    ),
  }));
}
export function closeDocument(path: string): void {
  cancelWorkspaceRestoration();
  selectionGeneration++;
  useWorkspace.setState((state) => {
    const documents = state.documents.filter((document) => document.path !== path);
    return {
      documents,
      activePath: state.activePath === path ? (documents.at(-1)?.path ?? null) : state.activePath,
    };
  });
}
/** Every explicit tab selection supersedes pending reads as well as saved-session focus. */
export function selectDocument(path: string): void {
  cancelWorkspaceRestoration();
  selectionGeneration++;
  if (useWorkspace.getState().documents.some((document) => document.path === path))
    useWorkspace.setState({ activePath: path, navigation: null });
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
export function saveDocument(path: string): Promise<boolean> {
  const document = useWorkspace.getState().documents.find((item) => item.path === path);
  if (!document) return Promise.resolve(true);
  return documentSessions.save(document.projectId, path, () =>
    saveDocumentOnce(document.projectId, path),
  );
}

export function documentSavesSettled(): Promise<void> {
  return documentSessions.savesSettled();
}

async function saveDocumentOnce(projectId: string, path: string): Promise<boolean> {
  const document = useWorkspace.getState().documents.find((item) => item.path === path);
  if (!document || document.projectId !== projectId || !dirty(document)) return true;
  const capture = documentSessions.capture(projectId, path);
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
            item.path === path &&
            item.projectId === projectId &&
            capture &&
            documentSessions.owns(capture)
              ? { ...item, conflict: true, externalState: 'stable' }
              : item,
          ),
        }));
      throw new Error(result.error);
    }
    useWorkspace.setState((state) => ({
      documents: state.documents.map((item) =>
        item.path === path &&
        item.projectId === document.projectId &&
        capture &&
        documentSessions.owns(capture)
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
