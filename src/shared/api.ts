import type { BuildRecipe, RecipeSettings, RecipeTool } from './recipes';
import type {
  AIModelInfo,
  AIModelRef,
  AIProviderId,
  AIProviderLink,
  AIAgentDocument,
  AIAgentContext,
  AIAssistantRequest,
  AIAssistantResult,
  AIAssistantEvent,
  AIInlineEditChunk,
  AIReviewOutcome,
  AIEditProposal,
  AIStoredChat,
  AIAgentReviewRequest,
  AIAgentReviewResult,
  AIRole,
  AIRoleDefaults,
  AIAutomaticSettings,
  AICompletionRequest,
  AICompletionResponse,
  AIInlineEditRequest,
  AIInlineEditResponse,
  AIProviderConfiguration,
  AIModelVisibility,
} from './ai';
export const PRODUCT_NAME = 'TeXtra';
export type Theme =
  'dark' | 'light' | 'midnight' | 'forest' | 'ocean' | 'rose' | 'sand' | (string & {});
export type ChktexRunMode = 'save' | 'live';
/** Policy for external changes to open .tex documents. Local to this device. */
export type ConflictPolicy = 'manual-review' | 'background-merge';
export type DiagnosticSeverity = Diagnostic['severity'];
export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}
export type WindowAction = 'minimize' | 'toggle-maximize' | 'close';
export interface WindowState {
  maximized: boolean;
  customControls: boolean;
}
export interface CustomTheme {
  id: string;
  name: string;
  baseTheme: 'dark' | 'light' | 'midnight' | 'forest' | 'ocean' | 'rose' | 'sand';
  accent?: string;
  accentStrong?: string;
  accentBackground?: string;
  background?: string;
  surface?: string;
  text?: string;
  uiFont?: string;
  editorFont?: string;
}
export interface Preferences {
  version: 1;
  theme: Theme;
  /** Accent overrides apply to every built-in color scheme. */
  themeCustomizations: ThemeCustomizations;
  sidebarVisible: boolean;
  previewVisible: boolean;
  outputVisible: boolean;
  editorWidth: number;
  defaultRecipe: BuildEngine;
  fontSize: number;
  wrap: boolean;
  /** Save edited documents after the configured idle delay. Disabled by default. */
  autoSave: boolean;
  autoSaveDelayMs: number;
  /** Detect modifications by editors and background coding agents. */
  externalChangeDetection: boolean;
  /** Require this quiet period before an external version is offered for comparison. */
  externalChangeQuietPeriodMs: number;
  /** Prefer revision polling when native watching is unreliable on synced/network drives. */
  externalChangePollingOnly: boolean;
  /** Open the read-only comparison after a conflict snapshot is created. */
  openDiffAfterConflictCopy: boolean;
  /** Display Monaco's document overview minimap. */
  editorMinimap: boolean;
  /** Show plain-language explanations for frequently encountered TeX build errors. */
  commonProblemHelp: boolean;
  /** Controls the compact rich-text-style LaTeX formatting bar above the source editor. */
  formatToolbarVisible: boolean;
  sidebarWidth: number;
  /** TexLab is bundled and enabled by default; users may opt out of enhanced language tooling. */
  texlabEnabled: boolean;
  /** ChkTeX remains optional because its style rules vary across projects. */
  chktexEnabled: boolean;
  /** Run ChkTeX after saving, or let the editor schedule debounced checks while typing. */
  chktexRunMode: ChktexRunMode;
  /** ChkTeX warning codes that should not be reported for this user. */
  chktexIgnoredRules: number[];
  /** Severity overrides keyed by a numeric ChkTeX warning code. */
  chktexRuleSeverities: Record<string, DiagnosticSeverity>;
  /** Optional absolute executable overrides keyed by TeX tool name. Not secrets. */
  toolPaths: Partial<Record<ConfigurableTool, string>>;
  /** Restore the previous workspace after a normal restart. */
  restoreSession: boolean;
  /** Keep close controls visible or reveal them when a tab is hovered. */
  tabCloseButtons: 'always' | 'hover';
  /** Open a file in a reusable preview tab until it is edited. */
  previewTabs: boolean;
  /** Command names, newest first; only labels are stored. */
  recentCommands: string[];
  /** Application UI font family. */
  uiFont?: string;
  /** Monaco editor font family. */
  editorFont?: string;
  /** Saved user custom themes. */
  customThemes?: CustomTheme[];
  /** User customized keyboard shortcuts mapped by action id. */
  keyboardShortcuts?: Record<string, string>;
  /** Keep Math Symbols open by default in Snippets tab. */
  snippetsSymbolsOpenDefault?: boolean;
  /** Keep Templates & Snippets open by default in Snippets tab. */
  snippetsTemplatesOpenDefault?: boolean;
  /** Keep flat-file compressed history in .textra/history. */
  historyEnabled: boolean;
  /** Minutes between automatic snapshots of modified files. */
  historyIntervalMinutes: number;
  /** Recipes saved in the user's TeXtra profile, available to copy into any project. */
  globalBuildRecipes?: { recipes: BuildRecipe[]; tools: RecipeTool[] };
}
export interface ThemeCustomizations {
  accent: string;
  accentStrong: string;
  accentBackground: string;
  background?: string;
  surface?: string;
  text?: string;
}
export const CONFIGURABLE_TOOLS = [
  'pdflatex',
  'xelatex',
  'lualatex',
  'latexmk',
  'bibtex',
  'biber',
  'synctex',
  'chktex',
  'latexindent',
] as const;
export type ConfigurableTool = (typeof CONFIGURABLE_TOOLS)[number];
export const SIDEBAR_WIDTH_RANGE = { min: 160, max: 480 } as const;
export const FONT_SIZE_RANGE = { min: 10, max: 28 } as const;
export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  theme: 'dark',
  themeCustomizations: {
    accent: '#9bc9bb',
    accentStrong: '#b0ddcf',
    accentBackground: '#293e37',
  },
  sidebarVisible: true,
  previewVisible: true,
  outputVisible: true,
  editorWidth: 55,
  defaultRecipe: 'pdflatex',
  fontSize: 14,
  wrap: false,
  autoSave: false,
  autoSaveDelayMs: 3000,
  externalChangeDetection: true,
  externalChangeQuietPeriodMs: 3000,
  externalChangePollingOnly: false,
  openDiffAfterConflictCopy: false,
  editorMinimap: false,
  commonProblemHelp: true,
  formatToolbarVisible: true,
  sidebarWidth: 226,
  texlabEnabled: true,
  chktexEnabled: true,
  chktexRunMode: 'save',
  chktexIgnoredRules: [],
  chktexRuleSeverities: {},
  toolPaths: {},
  restoreSession: true,
  tabCloseButtons: 'hover',
  previewTabs: false,
  recentCommands: [],
  uiFont: '',
  editorFont: '',
  customThemes: [],
  keyboardShortcuts: {},
  snippetsSymbolsOpenDefault: false,
  snippetsTemplatesOpenDefault: false,
  historyEnabled: true,
  historyIntervalMinutes: 10,
  globalBuildRecipes: { recipes: [], tools: [] },
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
  treeState?: 'loading' | 'complete';
}
export interface RestoredPdf {
  projectId: string;
  rootFile: string;
  path: string;
  recipeId: string | null;
  compiledAt: string;
  pdfVersion: number;
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
/** A file monitored by the main process for changes made outside TeXtra. */
export interface ExternalWatchRequest extends FileRef {
  /** Some network and sync folders report unreliable native watch events. */
  pollingOnly?: boolean;
  /** The unchanged interval required before a changed file is safe to compare. */
  quietPeriodMs?: number;
}
export interface ExternalWatchState extends FileRef {
  state: 'watching' | 'changing' | 'stable' | 'deleted' | 'renamed';
  revision: string | null;
  observedAt: number;
}
export type ExternalFileChangeEvent = ExternalWatchState;
export interface CreateConflictCopyRequest extends FileRef {
  /** The preserved in-memory editor buffer. It is never written over the source file. */
  content: string;
}
export type HistorySnapshotTrigger = 'save' | 'interval' | 'compile' | 'ai' | 'format' | 'manual';
export interface HistorySnapshotSummary {
  id: string;
  path: string;
  createdAt: string;
  sizeBytes: number;
  revision: string;
  trigger: HistorySnapshotTrigger;
  pinned: boolean;
  label: string | null;
}
export interface HistorySnapshotContent extends HistorySnapshotSummary {
  content: string;
}
export interface ListFileHistoryRequest extends FileRef {
  cursor?: string;
  limit?: number;
}
export interface HistorySnapshotPage {
  snapshots: HistorySnapshotSummary[];
  nextCursor: string | null;
}
export interface LegacyHistorySummary {
  id: string;
  snapshotCount: number;
  latestCreatedAt: string | null;
  samplePaths: string[];
}
export interface CreateHistorySnapshotRequest extends FileRef {
  content: string;
  trigger: HistorySnapshotTrigger;
  force?: boolean;
  label?: string;
}
export interface HistorySnapshotRef extends FileRef {
  snapshotId: string;
}
export interface PinHistorySnapshotRequest extends HistorySnapshotRef {
  pinned: boolean;
  label?: string | null;
}
export interface RestoreHistorySnapshotRequest extends HistorySnapshotRef {
  expectedRevision: string;
  /** Captured editor text which must be durably backed up before restoration. */
  recoveryBuffer: string;
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
export type SetupLink = 'miktex' | 'texlive' | 'mactex' | 'latexindent' | 'chktexRules';
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
export type LintRequest = FileRef & { requestId?: string };
export interface FormatRequest extends FileRef {
  requestId?: string;
  content: string;
}
export interface FormatResult {
  content: string;
  formatter: 'latexindent';
}
export interface BuildArtifactCleanupResult {
  /** False means the TeXtra-managed build folder was already absent. */
  removed: boolean;
}
export interface CleanAuxiliaryResult {
  removedCount: number;
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
export interface AIProviderSettings {
  id: AIProviderId;
  enabled?: boolean;
  endpoint?: string;
  displayName?: string;
  filters?: { chat: AIModelVisibility; completion: AIModelVisibility };
  supportsTools?: boolean;
  manualModels?: string[];
  /** A key is saved, or local Ollama has been enabled. */
  configured: boolean;
  /** This provider's preferred model, used when it is chosen without a specific model. */
  defaultModel: string | null;
  /** Models returned by the provider's own model listing, cached locally. */
  models: AIModelInfo[];
  modelsFetchedAt: number | null;
  /** Last model-listing failure, safe to display. */
  error: string | null;
}
export interface AISettings {
  /** The Assistant role has a configured default model. */
  configured: boolean;
  autoSendProblems: boolean;
  roleDefaults: AIRoleDefaults;
  completion: AIAutomaticSettings;
  providers: AIProviderSettings[];
}
export interface OllamaLocalStatus {
  running: boolean;
  version: string | null;
  /** An Ollama executable was found, so TeXtra can try to start it. */
  installed: boolean;
}
export interface AIMessage {
  role: 'user' | 'model';
  text: string;
  /** Model turns only: what the user did with the proposal that turn produced. */
  review?: AIReviewOutcome;
}
export interface TextraAPI {
  getAISettings(): Promise<Result<AISettings>>;
  configureAIProvider(request: AIProviderConfiguration): Promise<Result<AISettings>>;
  requestAIInlineEdit(request: AIInlineEditRequest): Promise<Result<AIInlineEditResponse>>;
  cancelAIInlineEdit(request: { requestId: string }): Promise<Result<void>>;
  /** Tests a key (or local server) by listing models, then saves it with those models. */
  saveAIProvider(request: { provider: AIProviderId; apiKey?: string }): Promise<Result<AISettings>>;
  /** Confirms locally before removing a provider; null means cancelled. */
  removeAIProvider(request: { provider: AIProviderId }): Promise<Result<AISettings | null>>;
  refreshAIModels(request: { provider: AIProviderId }): Promise<Result<AISettings>>;
  setAIProviderDefault(request: {
    provider: AIProviderId;
    model: string;
  }): Promise<Result<AISettings>>;
  setAIRoleDefault(request: {
    role: AIRole;
    model: AIModelRef | null;
  }): Promise<Result<AISettings>>;
  setAICompletionSettings(request: {
    enabled: boolean;
    allowOutsideEnvironments: boolean;
  }): Promise<Result<AISettings | null>>;
  requestAICompletion(request: AICompletionRequest): Promise<Result<AICompletionResponse>>;
  cancelAICompletion(request: { requestId: string }): Promise<Result<void>>;
  setAIAutoSend(request: { autoSendProblems: boolean }): Promise<Result<AISettings>>;
  getOllamaStatus(): Promise<Result<OllamaLocalStatus>>;
  startOllama(): Promise<Result<OllamaLocalStatus>>;
  syncAIAgentDocument(document: AIAgentDocument | null): Promise<Result<AIAgentContext | null>>;
  /** Runs one assistant request; register onAIAssistantEvent before calling. */
  runAIAssistant(request: AIAssistantRequest): Promise<Result<AIAssistantResult>>;
  /** Cancels only the named request (or records it so it never starts). */
  cancelAIAssistant(request: { requestId: string }): Promise<Result<void>>;
  onAIAssistantEvent(listener: (event: AIAssistantEvent) => void): () => void;
  onAIInlineEditChunk(listener: (chunk: AIInlineEditChunk) => void): () => void;
  acceptAIAgentProposal(request: {
    id: string;
    contextId: string;
    hunkIds?: string[];
  }): Promise<Result<AIEditProposal>>;
  rejectAIAgentProposal(id: string): Promise<Result<void>>;
  reviewAIAgentProposal(request: AIAgentReviewRequest): Promise<Result<AIAgentReviewResult>>;
  openAIProviderLink(request: {
    provider: AIProviderId;
    link: AIProviderLink;
  }): Promise<Result<void>>;
  listAIChats(projectId: string): Promise<Result<AIStoredChat[]>>;
  saveAIChat(request: { projectId: string; chat: AIStoredChat }): Promise<Result<void>>;
  deleteAIChat(request: { projectId: string; chatId: string }): Promise<Result<boolean>>;
  getAppInfo(): Promise<Result<AppInfo>>;
  getPreferences(): Promise<Result<Preferences>>;
  setPreferences(value: Preferences): Promise<Result<Preferences>>;
  getProjectConflictPolicy(projectId: string): Promise<Result<ConflictPolicy>>;
  setProjectConflictPolicy(request: { projectId: string; policy: ConflictPolicy }): Promise<Result<ConflictPolicy>>;
  getWindowState(): Promise<Result<WindowState>>;
  controlWindow(action: WindowAction): Promise<Result<void>>;
  onWindowState(listener: (state: WindowState) => void): () => void;
  /** Flush renderer-owned persistence before the native close decision. */
  onBeforeClose(listener: (requestId: string) => void): () => void;
  onCloseCancelled(listener: () => void): () => void;
  acknowledgeBeforeClose(request: { requestId: string; ready: boolean }): Promise<Result<void>>;
  chooseProject(): Promise<Result<ProjectInfo | null>>;
  refreshProject(projectId: string): Promise<Result<ProjectInfo>>;
  prepareProject(projectId: string): Promise<Result<void>>;
  readFile(request: FileRef): Promise<Result<FileSnapshot>>;
  saveFile(request: SaveRequest): Promise<Result<FileSnapshot>>;
  createEntry(request: CreateRequest): Promise<Result<ProjectInfo>>;
  renameEntry(request: RenameRequest): Promise<Result<ProjectInfo | null>>;
  deleteEntry(request: FileRef): Promise<Result<ProjectInfo | null>>;
  getFileRevisions(request: {
    projectId: string;
    paths: string[];
  }): Promise<Result<FileRevision[]>>;
  watchExternalFile(request: ExternalWatchRequest): Promise<Result<ExternalWatchState>>;
  unwatchExternalFile(request: FileRef): Promise<Result<void>>;
  /** Subscribe to state changes for files registered with watchExternalFile. */
  onExternalFileChange(listener: (event: ExternalFileChangeEvent) => void): () => void;
  /** Creates a collision-safe sibling `*.CONFLICTED_timestamp.tex` snapshot. */
  createConflictCopy(request: CreateConflictCopyRequest): Promise<Result<FileSnapshot>>;
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
  restoreLastPdf(projectId: string): Promise<Result<RestoredPdf | null>>;
  prepareAI(): Promise<Result<void>>;
  /** Reads an explicit, validated PDF selected from the active project. */
  readProjectPdf(request: FileRef): Promise<Result<Uint8Array>>;
  syncForward(request: SyncForwardRequest): Promise<Result<PdfLocation>>;
  syncInverse(request: SyncInverseRequest): Promise<Result<SourceLocation>>;
  getProjectConfig(projectId: string): Promise<Result<ProjectConfig>>;
  setProjectConfig(request: {
    projectId: string;
    config: ProjectConfig;
    expectedConfig?: ProjectConfig;
  }): Promise<Result<ProjectConfig>>;
  /** Removes only the TeXtra-managed build/textra folder after native confirmation. */
  cleanProjectBuildArtifacts(projectId: string): Promise<Result<BuildArtifactCleanupResult>>;
  /** Safely removes auxiliary build files (.aux, .log, etc.) preserving all PDFs and source files. */
  cleanAuxiliaryFiles(request: {
    projectId: string;
    path?: string;
    recipe?: string;
  }): Promise<Result<CleanAuxiliaryResult>>;
  exportSettings(): Promise<Result<boolean>>;
  importSettings(): Promise<Result<Preferences | null>>;
  openUserDataFolder(): Promise<Result<void>>;
  openSetupLink(target: SetupLink): Promise<Result<void>>;
  testDistribution(): Promise<Result<{ success: boolean; log: string }>>;
  getLanguageToolStatus(): Promise<Result<LanguageToolStatus>>;
  getTexlabStatus(): Promise<Result<TexlabStatus>>;
  checkTexlab(): Promise<Result<TexlabStatus>>;
  syncTexlabDocument(request: TexlabDocumentRequest): Promise<Result<void>>;
  closeTexlabDocument(request: FileRef): Promise<Result<void>>;
  texlabRequest(request: TexlabRequest): Promise<Result<unknown>>;
  getTexlabDiagnostics(request: FileRef): Promise<Result<Diagnostic[]>>;
  lintLatex(request: LintRequest): Promise<Result<Diagnostic[]>>;
  formatLatex(request: FormatRequest): Promise<Result<FormatResult>>;
  cancelLanguageRequest(request: { requestId: string }): Promise<Result<void>>;
  openStackExchangeSearch(query: string): Promise<Result<void>>;
  openTexFaqHelp(url: string): Promise<Result<void>>;
  copyText(text: string): Promise<Result<void>>;
  listFileHistory(request: ListFileHistoryRequest): Promise<Result<HistorySnapshotPage>>;
  listLegacyFileHistories(projectId: string): Promise<Result<LegacyHistorySummary[]>>;
  importLegacyFileHistory(request: {
    projectId: string;
    legacyId: string;
  }): Promise<Result<number>>;
  readFileHistorySnapshot(request: HistorySnapshotRef): Promise<Result<HistorySnapshotContent>>;
  createFileHistorySnapshot(
    request: CreateHistorySnapshotRequest,
  ): Promise<Result<HistorySnapshotSummary | null>>;
  restoreFileHistorySnapshot(request: RestoreHistorySnapshotRequest): Promise<Result<FileSnapshot>>;
  pinFileHistorySnapshot(
    request: PinHistorySnapshotRequest,
  ): Promise<Result<HistorySnapshotSummary>>;
  exportFileHistorySnapshot(request: HistorySnapshotRef): Promise<Result<boolean>>;
  deleteFileHistorySnapshot(request: HistorySnapshotRef): Promise<Result<void>>;
}
declare global {
  interface Window {
    textra: TextraAPI;
  }
}
