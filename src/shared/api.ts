import type { RecipeSettings } from './recipes';
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
  previewVisible: boolean;
  outputVisible: boolean;
  editorWidth: number;
  defaultRecipe: BuildEngine;
  fontSize: number;
  wrap: boolean;
  /** Controls the compact rich-text-style LaTeX formatting bar above the source editor. */
  formatToolbarVisible: boolean;
  sidebarWidth: number;
  /** TexLab is bundled and enabled by default; users may opt out of enhanced language tooling. */
  texlabEnabled: boolean;
  /** Optional absolute executable overrides keyed by TeX tool name. Not secrets. */
  toolPaths: Partial<Record<ConfigurableTool, string>>;
}
export const CONFIGURABLE_TOOLS = [
  'pdflatex',
  'xelatex',
  'lualatex',
  'latexmk',
  'bibtex',
  'biber',
  'synctex',
] as const;
export type ConfigurableTool = (typeof CONFIGURABLE_TOOLS)[number];
export const SIDEBAR_WIDTH_RANGE = { min: 160, max: 480 } as const;
export const FONT_SIZE_RANGE = { min: 10, max: 28 } as const;
export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  theme: 'dark',
  sidebarVisible: true,
  previewVisible: true,
  outputVisible: true,
  editorWidth: 55,
  defaultRecipe: 'pdflatex',
  fontSize: 14,
  wrap: false,
  formatToolbarVisible: true,
  sidebarWidth: 226,
  texlabEnabled: true,
  toolPaths: {},
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
export const BUILD_RECIPES: { value: BuildEngine; label: string }[] = [
  { value: 'pdflatex', label: 'pdfLaTeX' },
  { value: 'xelatex', label: 'XeLaTeX' },
  { value: 'lualatex', label: 'LuaLaTeX' },
  { value: 'latexmk', label: 'latexmk' },
  { value: 'bibtex-pipeline', label: 'pdfLaTeX + BibTeX' },
];
export interface ToolInfo {
  name: string;
  path: string | null;
  version: string | null;
  /** True when the path comes from a user override rather than PATH. */
  custom?: boolean;
}
export interface BuildRequest {
  projectId: string;
  rootFile: string;
  engine: BuildEngine;
  recipe?: string;
}
export interface ProjectConfig extends Partial<RecipeSettings> {
  schemaVersion: 1;
  rootFile: string | null;
  engine: BuildEngine;
  recipes?: Record<string, string>;
}
export type SetupLink = 'miktex' | 'texlive' | 'mactex';
export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
  source?: 'build' | 'chktex' | 'reference' | 'texlab';
}
export interface LanguageToolStatus {
  texlab: boolean;
  chktex: boolean;
  latexindent: boolean;
}
export type TexlabInstallation = 'managed' | 'external' | 'missing' | 'error';
export interface TexlabStatus {
  enabled: boolean;
  installation: TexlabInstallation;
  path: string | null;
  version: string | null;
  detail: string | null;
  running: boolean;
}
export interface TexlabDocumentRequest extends FileRef {
  content: string;
  /** Monaco model version, used to order full-text LSP updates. */
  version: number;
}
export interface TexlabPositionRequest extends TexlabDocumentRequest {
  /** Zero-based line and character position required by LSP. */
  line: number;
  character: number;
}
export interface TexlabRequest extends TexlabDocumentRequest {
  method:
    | 'completion'
    | 'hover'
    | 'definition'
    | 'references'
    | 'documentSymbols'
    | 'foldingRanges'
    | 'inlayHints';
  line?: number;
  character?: number;
}
export type LintRequest = FileRef;
export interface FormatRequest extends FileRef {
  content: string;
}
export interface FormatResult {
  content: string;
  formatter: 'latexindent';
}
export interface BuildState {
  running: boolean;
  log: string;
  diagnostics: Diagnostic[];
  outcome: 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  pdfPath: string | null;
  pdfVersion?: number;
  projectId: string | null;
  rootFile: string | null;
  /** Recipe steps finished so far and the total, while a build runs. */
  stepsDone?: number;
  stepCount?: number;
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
  copyEntryPath(request: FileRef & { relative: boolean }): Promise<Result<void>>;
  openInCode(request: FileRef): Promise<Result<void>>;
  getRecentProjects(): Promise<Result<RecentProject[]>>;
  openRecentProject(id: string): Promise<Result<ProjectInfo>>;
  setProjectPinned(request: { id: string; pinned: boolean }): Promise<Result<RecentProject[]>>;
  setDirty(dirty: boolean): Promise<Result<void>>;
  detectTools(): Promise<Result<ToolInfo[]>>;
  /** Opens a native file chooser; returns a validated absolute path or null if cancelled. */
  chooseToolPath(name: ConfigurableTool): Promise<Result<string | null>>;
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
    expectedConfig?: ProjectConfig;
  }): Promise<Result<ProjectConfig>>;
  exportSettings(): Promise<Result<boolean>>;
  importSettings(): Promise<Result<Preferences | null>>;
  openSetupLink(target: SetupLink): Promise<Result<void>>;
  testDistribution(): Promise<Result<{ success: boolean; log: string }>>;
  getLanguageToolStatus(): Promise<Result<LanguageToolStatus>>;
  getTexlabStatus(): Promise<Result<TexlabStatus>>;
  checkTexlab(): Promise<Result<TexlabStatus>>;
  syncTexlabDocument(request: TexlabDocumentRequest): Promise<Result<void>>;
  texlabRequest(request: TexlabRequest): Promise<Result<unknown>>;
  getTexlabDiagnostics(request: FileRef): Promise<Result<Diagnostic[]>>;
  lintLatex(request: LintRequest): Promise<Result<Diagnostic[]>>;
  formatLatex(request: FormatRequest): Promise<Result<FormatResult>>;
  openStackExchangeSearch(query: string): Promise<Result<void>>;
  copyText(text: string): Promise<Result<void>>;
}
declare global {
  interface Window {
    textra: TextraAPI;
  }
}
