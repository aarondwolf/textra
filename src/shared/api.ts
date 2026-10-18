export const PRODUCT_NAME = 'TeXtra';
export type Theme = 'dark' | 'light';
export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}
export interface Preferences {
  version: 1;
  theme: Theme;
  sidebarVisible: boolean;
  outputVisible: boolean;
  editorWidth: number;
}
export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  theme: 'dark',
  sidebarVisible: true,
  outputVisible: true,
  editorWidth: 55,
};
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };
export interface FileEntry {
  path: string;
  name: string;
  kind: 'file' | 'directory';
}
export interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
  files: FileEntry[];
  mainFile: string | null;
  truncated: boolean;
}
export interface FileRef {
  projectId: string;
  path: string;
}
export interface FileSnapshot extends FileRef {
  content: string;
  revision: string;
}
export interface SaveRequest extends FileRef {
  content: string;
  expectedRevision: string;
}
export interface CreateRequest extends FileRef {
  kind: 'file' | 'directory';
  content?: string;
}
export interface RenameRequest extends FileRef {
  newPath: string;
}
export interface FileRevision {
  path: string;
  revision: string | null;
}
export interface RecentProject {
  id: string;
  name: string;
  rootPath: string;
  pinned: boolean;
}
export type BuildEngine = 'pdflatex' | 'xelatex' | 'lualatex' | 'latexmk' | 'bibtex-pipeline';
export interface ToolInfo {
  name: string;
  path: string | null;
  version: string | null;
}
export interface BuildRequest {
  projectId: string;
  rootFile: string;
  engine: BuildEngine;
}
export interface ProjectConfig {
  schemaVersion: 1;
  rootFile: string | null;
  engine: BuildEngine;
}
export type SetupLink = 'miktex' | 'texlive' | 'mactex';
export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
}
export interface BuildState {
  running: boolean;
  log: string;
  diagnostics: Diagnostic[];
  outcome: 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  pdfPath: string | null;
  projectId: string | null;
  rootFile: string | null;
}
export interface SyncForwardRequest extends FileRef {
  rootFile: string;
  line: number;
}
export interface SyncInverseRequest {
  projectId: string;
  rootFile: string;
  page: number;
  x: number;
  y: number;
}
export interface PdfLocation {
  page: number;
  x: number;
  y: number;
}
export interface SourceLocation {
  path: string;
  line: number;
  column: number;
}
export interface TextraAPI {
  getAppInfo(): Promise<Result<AppInfo>>;
  getPreferences(): Promise<Result<Preferences>>;
  setPreferences(value: Preferences): Promise<Result<Preferences>>;
  chooseProject(): Promise<Result<ProjectInfo | null>>;
  refreshProject(projectId: string): Promise<Result<ProjectInfo>>;
  readFile(request: FileRef): Promise<Result<FileSnapshot>>;
  saveFile(request: SaveRequest): Promise<Result<FileSnapshot>>;
  createEntry(request: CreateRequest): Promise<Result<ProjectInfo>>;
  renameEntry(request: RenameRequest): Promise<Result<ProjectInfo | null>>;
  deleteEntry(request: FileRef): Promise<Result<ProjectInfo | null>>;
  getFileRevisions(request: {
    projectId: string;
    paths: string[];
  }): Promise<Result<FileRevision[]>>;
  revealEntry(request: FileRef): Promise<Result<void>>;
  openInCode(request: FileRef): Promise<Result<void>>;
  getRecentProjects(): Promise<Result<RecentProject[]>>;
  openRecentProject(id: string): Promise<Result<ProjectInfo>>;
  setProjectPinned(request: { id: string; pinned: boolean }): Promise<Result<RecentProject[]>>;
  setDirty(dirty: boolean): Promise<Result<void>>;
  detectTools(): Promise<Result<ToolInfo[]>>;
  compile(request: BuildRequest): Promise<Result<BuildState>>;
  cancelBuild(): Promise<Result<void>>;
  getBuildState(): Promise<Result<BuildState>>;
  readPdf(request: FileRef): Promise<Result<Uint8Array>>;
  syncForward(request: SyncForwardRequest): Promise<Result<PdfLocation>>;
  syncInverse(request: SyncInverseRequest): Promise<Result<SourceLocation>>;
  getProjectConfig(projectId: string): Promise<Result<ProjectConfig>>;
  setProjectConfig(request: {
    projectId: string;
    config: ProjectConfig;
  }): Promise<Result<ProjectConfig>>;
  exportSettings(): Promise<Result<boolean>>;
  importSettings(): Promise<Result<Preferences | null>>;
  openSetupLink(target: SetupLink): Promise<Result<void>>;
  testDistribution(): Promise<Result<{ success: boolean; log: string }>>;
}
declare global {
  interface Window {
    textra: TextraAPI;
  }
}
