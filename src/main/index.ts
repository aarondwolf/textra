import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  clipboard,
  safeStorage,
  type IpcMainInvokeEvent,
} from 'electron';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CONFIGURABLE_TOOLS,
  PRODUCT_NAME,
  type ConfigurableTool,
  type Result,
  type TextraAPI,
} from '../shared/api';
import { isTrustedRendererUrl } from './security';
import { log } from './services/logger';
import { PreferencesStore } from './services/preferences';
import { ProjectError, ProjectService, validateRelativePath } from './services/projects';
import {
  ExternalEditorService,
  findCodeExecutable,
  openInExternalEditor,
} from './services/external-editor';
import { BuildService, detectTools } from './services/latex';
import { setToolPaths, validateToolPath } from './services/tool-paths';
import { ConfigService, exportSettings, importSettings } from './services/settings';
import { validateRecipeSettings } from '../shared/recipes';
import { LanguageService } from './services/language';
import { TexlabManager } from './services/texlab-manager';
import { TexlabError } from './services/texlab';
import { AIError, AIService, validateCompletionRequest } from './services/ai-service';
import { AIInlineEditService, validateInlineEditRequest } from './services/ai-inline-edit';
import { BoundedAgentService } from './services/agent';
import { AgentWorkspaceService } from './services/agent-workspace';
import { AI_PROVIDERS, isAIProviderId } from '../shared/ai';
import { AIChatStore } from './services/ai-chats';

const directory = dirname(fileURLToPath(import.meta.url));
const rendererFile = join(directory, '../renderer/index.html');
const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const rendererUrl = developmentUrl ?? pathToFileURL(rendererFile).href;
if (!isTrustedRendererUrl(rendererUrl, rendererUrl)) {
  throw new Error('The development renderer must use a local HTTP address.');
}

app.setName(PRODUCT_NAME);
const testUserData = !app.isPackaged ? process.env.TEXTRA_USER_DATA_DIR : undefined;
if (testUserData) {
  if (!isAbsolute(testUserData)) throw new Error('Test user data directory must be absolute.');
  app.setPath('userData', testUserData);
}

let mainWindow: BrowserWindow | null = null;
const preferences = new PreferencesStore(app.getPath('userData'));
const ai = new AIService(
  join(app.getAppPath(), '.textra-local'),
  {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  },
  {
    onCompletionDiagnostic: (diagnostic) => {
      if (diagnostic.normalization === 'failed') log('warn', 'ai-completion-failed', diagnostic);
    },
    confirmAutomatic: async (model, endpoint) => {
      const info = AI_PROVIDERS[model.provider];
      const answer = await dialog.showMessageBox(requireWindow(), {
        type: 'question',
        title: 'Enable automatic AI suggestions?',
        message: 'Allow automatic suggestions from ' + info.label + ' / ' + model.model + '?',
        detail:
          (endpoint
            ? 'Destination: ' +
              endpoint +
              (model.provider === 'openrouter'
                ? ' and the selected downstream model provider.'
                : model.provider === 'ollama-local' && /cloud/i.test(model.model)
                  ? ' (Ollama Cloud through this server).'
                  : '.')
            : info.local
              ? /cloud/i.test(model.model)
                ? 'Destination: Ollama Cloud through the local Ollama server.'
                : 'Destination: local Ollama on this computer.'
              : 'Destination: ' +
                info.label +
                (model.provider === 'openrouter'
                  ? ' and the selected downstream model provider.'
                  : '.')) +
          ' After typing pauses, TeXtra sends up to 8,000 characters before the cursor, 2,000 after it, and 2,000 characters of metadata from the active file. Suggestions are never inserted automatically.',
        buttons: ['Cancel', 'Allow automatic suggestions'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return answer.response === 1;
    },
  },
);
const projects = new ProjectService(app.getPath('userData'));
const inlineEdits = new AIInlineEditService(ai);
const agent = new BoundedAgentService(ai);
const agentWorkspace = new AgentWorkspaceService(projects, agent);
const aiChats = new AIChatStore(join(app.getPath('userData'), 'ai-chats'), (id) =>
  projects.getRoot(id),
);
const externalEditor = new ExternalEditorService(projects);
const builds = new BuildService((id) => projects.getRoot(id));
const config = new ConfigService(app.getPath('userData'), (id) => projects.getRoot(id));
const language = new LanguageService(projects, () => preferences.get());
const texlab = new TexlabManager(
  projects,
  app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources'),
  async () => (await preferences.get()).texlabEnabled,
);
let healthBuild: BuildService | null = null;
let dirty = false;
let forceClose = false;

function requireIdleProject(): void {
  if (builds.getState().running)
    throw new ProjectError(
      'BUILD_RUNNING',
      'Cancel the current build before changing projects or files.',
    );
  if (dirty)
    throw new ProjectError('DIRTY_FILES', 'Save or explicitly discard your unsaved edits first.');
}

function requireWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed())
    throw new ProjectError('NO_WINDOW', 'The application window is no longer available.');
  return mainWindow;
}

function errorResult(error: unknown): { ok: false; error: string; code: string } {
  if (error instanceof AIError) return { ok: false, error: error.message, code: error.code };
  if (error instanceof ProjectError || (error instanceof Error && error.name === 'SettingsError'))
    return {
      ok: false,
      error: error.message,
      code: 'code' in error && typeof error.code === 'string' ? error.code : 'INVALID_SETTINGS',
    };
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'EEXIST')
    return {
      ok: false,
      code: 'ALREADY_EXISTS',
      error: 'A file or folder already exists at that path.',
    };
  if (code === 'ENOENT')
    return { ok: false, code: 'NOT_FOUND', error: 'The selected file or folder no longer exists.' };
  if (code === 'EACCES' || code === 'EPERM')
    return {
      ok: false,
      code: 'ACCESS_DENIED',
      error: 'Permission was denied. Existing files were preserved.',
    };
  if (error instanceof Error && error.name === 'BuildError')
    return {
      ok: false,
      code: typeof code === 'string' ? code : 'BUILD_ERROR',
      error: error.message,
    };
  if (error instanceof TexlabError)
    return {
      ok: false,
      code: error.code,
      error:
        'TexLab could not complete this language request. TeXtra local suggestions remain available.',
    };
  return {
    ok: false,
    code: 'REQUEST_FAILED',
    error: 'The request could not be completed. Existing data was preserved.',
  };
}

function validateSender(event: IpcMainInvokeEvent): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !event.senderFrame ||
    !isTrustedRendererUrl(event.senderFrame.url, rendererUrl)
  ) {
    throw new Error('Untrusted IPC sender.');
  }
}

function handle<T>(
  channel: string,
  argumentCount: number,
  action: (...args: unknown[]) => Promise<T> | T,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Result<T>> => {
    try {
      validateSender(event);
      if (args.length !== argumentCount) throw new Error('Unexpected arguments.');
      return { ok: true, value: await action(...args) };
    } catch (error) {
      // Raw errors can contain local paths or private preference data.
      const result = errorResult(error);
      const expectedCompletionStop =
        (channel === 'textra:ai:completion:request' ||
          channel === 'textra:ai:inline-edit:request') &&
        (result.code === 'AI_CANCELLED' || result.code === 'AI_BUSY');
      if (!expectedCompletionStop)
        log('warn', 'ipc-request-failed', { channel, code: result.code });
      return result;
    }
  });
}

/** Adapters stay typed; every service validates its incoming request at runtime. */
function handleRequest<K extends keyof TextraAPI>(
  channel: string,
  action: (...args: Parameters<TextraAPI[K]>) => unknown,
): void {
  handle(channel, 1, (value) => action(...([value] as Parameters<TextraAPI[K]>)));
}

function createWindow(): void {
  forceClose = false;
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#141821',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(directory, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  mainWindow = window;
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => {
    if (!isTrustedRendererUrl(event.url, rendererUrl)) event.preventDefault();
  });
  window.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isTrustedRendererUrl(event.url, rendererUrl)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => {
    log('error', 'renderer-process-gone', { reason: details.reason });
  });
  window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (forceClose) return;
    if (dirty || builds.getState().running) {
      const answer = dialog.showMessageBoxSync(window, {
        type: 'warning',
        title: 'Close TeXtra?',
        message: dirty
          ? 'Discard unsaved edits and close TeXtra?'
          : 'Stop the running build and close TeXtra?',
        detail: 'Changes that have not been saved will be lost. Any running build will be stopped.',
        buttons: ['Keep working', 'Close'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (answer !== 1) {
        event.preventDefault();
        return;
      }
    }
    event.preventDefault();
    forceClose = true;
    void Promise.all([
      builds.cancel(),
      healthBuild?.cancel(),
      projects.flush(),
      config.flush(),
      aiChats.flush(),
    ])
      .then(() => {
        dirty = false;
        if (!window.isDestroyed()) window.close();
      })
      .catch(() => {
        forceClose = false;
        log('error', 'close-cleanup-failed');
      });
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  const loading = developmentUrl ? window.loadURL(developmentUrl) : window.loadFile(rendererFile);
  void loading.catch(() => log('error', 'renderer-load-failed'));
}

void app.whenReady().then(() => {
  externalEditor.onChange((change) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('textra:file:external-change', change);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (event) => event.preventDefault());
  handle('textra:app-info', 0, () => ({
    name: PRODUCT_NAME,
    version: app.getVersion(),
    platform: process.platform,
  }));
  handle('textra:ai:settings', 0, () => ai.settings());
  handleRequest<'configureAIProvider'>('textra:ai:provider:configure', (request) =>
    ai.configureProvider(request),
  );
  handleRequest<'requestAIInlineEdit'>('textra:ai:inline-edit:request', async (request) => {
    validateInlineEditRequest(request);
    await projects.resolvePath({ projectId: request.projectId, path: request.path });
    const receiver = requireWindow().webContents;
    const requestId = request.requestId;
    return inlineEdits.request(request, (text) => {
      if (!receiver.isDestroyed())
        receiver.send('textra:ai:inline-edit:chunk', { requestId, text: text.slice(0, 32_000) });
    });
  });
  handleRequest<'cancelAIInlineEdit'>('textra:ai:inline-edit:cancel', (request) =>
    inlineEdits.cancel(request),
  );
  handleRequest<'saveAIProvider'>('textra:ai:provider:save', (request) => ai.saveProvider(request));
  handleRequest<'removeAIProvider'>('textra:ai:provider:remove', async (request) => {
    const provider = request && isAIProviderId(request.provider) ? request.provider : null;
    if (!provider) throw new AIError('INVALID_ARGUMENT', 'Choose a supported AI provider.');
    const info = AI_PROVIDERS[provider];
    const answer = await dialog.showMessageBox(requireWindow(), {
      type: 'question',
      title: `Remove ${info.label}?`,
      message: `Remove the ${info.label} connection from TeXtra?`,
      detail:
        provider === 'ollama-local'
          ? 'Its models leave the model list. Ollama itself and your downloaded models are not affected.'
          : 'Its models and role bindings are removed. Any saved API key is deleted locally; it is not revoked with the provider.',
      buttons: ['Cancel', 'Remove'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return answer.response === 1 ? ai.removeProvider(request) : null;
  });
  handleRequest<'refreshAIModels'>('textra:ai:models:refresh', (request) =>
    ai.refreshModels(request),
  );
  handleRequest<'setAIProviderDefault'>('textra:ai:provider:default', (request) =>
    ai.setProviderDefault(request),
  );
  handleRequest<'setAIRoleDefault'>('textra:ai:role-default', (request) =>
    ai.setRoleDefault(request),
  );
  handleRequest<'setAICompletionSettings'>('textra:ai:completion:settings', (request) =>
    ai.setCompletionSettings(request),
  );
  handleRequest<'requestAICompletion'>('textra:ai:completion:request', async (request) => {
    validateCompletionRequest(request);
    await projects.resolvePath({ projectId: request.projectId, path: request.path });
    return ai.complete(request);
  });
  handleRequest<'cancelAICompletion'>('textra:ai:completion:cancel', (request) =>
    ai.cancelCompletion(request),
  );
  handleRequest<'setAIAutoSend'>('textra:ai:auto-send', (request) => ai.setAutoSend(request));
  handle('textra:ai:ollama:status', 0, () => ai.ollamaStatus());
  handle('textra:ai:ollama:start', 0, () => ai.startOllama());
  handleRequest<'syncAIAgentDocument'>('textra:agent:document', (request) =>
    agentWorkspace.sync(request),
  );
  handleRequest<'runAIAssistant'>('textra:ai:assistant:run', (request) => {
    const receiver = requireWindow().webContents;
    return agentWorkspace.run(request, (event) => {
      // Display-only events: bounded text and status, never tool payloads or provider data.
      if (!receiver.isDestroyed()) receiver.send('textra:ai:assistant:event', event);
    });
  });
  handleRequest<'cancelAIAssistant'>('textra:ai:assistant:cancel', (request) =>
    agentWorkspace.cancel(request),
  );
  handleRequest<'acceptAIAgentProposal'>('textra:agent:accept', (request) =>
    agentWorkspace.accept(request),
  );
  handleRequest<'rejectAIAgentProposal'>('textra:agent:reject', (request) =>
    agentWorkspace.reject(request),
  );
  handleRequest<'reviewAIAgentProposal'>('textra:agent:review', (request) =>
    agentWorkspace.review(request),
  );
  handleRequest<'openAIProviderLink'>('textra:ai:link', (request) => {
    const url =
      request && isAIProviderId(request.provider) && typeof request.link === 'string'
        ? AI_PROVIDERS[request.provider].links[request.link]
        : undefined;
    if (!url) throw new AIError('INVALID_ARGUMENT', 'That provider link is not available.');
    return shell.openExternal(url);
  });
  handleRequest<'listAIChats'>('textra:ai:chats:list', (projectId) => aiChats.list(projectId));
  handleRequest<'saveAIChat'>('textra:ai:chats:save', (request) => aiChats.save(request));
  handleRequest<'deleteAIChat'>('textra:ai:chats:delete', async (request) => {
    if (
      !request ||
      Object.keys(request).length !== 2 ||
      typeof request.projectId !== 'string' ||
      typeof request.chatId !== 'string' ||
      !/^[A-Za-z0-9-]{1,64}$/.test(request.chatId)
    )
      throw new AIError('AI_CHAT_STORAGE', 'Provide a valid workspace chat ID.');
    const chat = (await aiChats.list(request.projectId)).find((item) => item.id === request.chatId);
    if (!chat) return false;
    const answer = await dialog.showMessageBox(requireWindow(), {
      type: 'warning',
      title: 'Delete saved chat?',
      message: `Permanently delete “${chat.title}”?`,
      detail:
        'This removes only the saved TeXtra chat history. It does not affect your LaTeX files.',
      buttons: ['Cancel', 'Delete chat'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1) return false;
    return aiChats.deleteChat(request);
  });
  handle('textra:preferences:get', 0, () => preferences.get());
  void preferences
    .get()
    .then((saved) => setToolPaths(saved.toolPaths))
    .catch(() => undefined);
  handle('textra:preferences:set', 1, async (value) => {
    const saved = await preferences.set(value);
    setToolPaths(saved.toolPaths);
    if (!saved.texlabEnabled) await texlab.stop();
    return saved;
  });
  handle('textra:tools:choose', 1, async (name) => {
    if (typeof name !== 'string' || !(CONFIGURABLE_TOOLS as readonly string[]).includes(name))
      throw new ProjectError('INVALID_ARGUMENT', 'Choose a supported TeX tool.');
    const tool = name as ConfigurableTool;
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: `Locate ${tool}`,
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Executable', extensions: ['exe'] }] : [],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      return validateToolPath(tool, result.filePaths[0]);
    } catch {
      throw new ProjectError('INVALID_ARGUMENT', `Choose the file named ${tool}.`);
    }
  });
  handle('textra:project:choose', 0, async () => {
    requireIdleProject();
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: 'Open LaTeX project',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    requireIdleProject();
    externalEditor.clear();
    const project = await projects.openRoot(result.filePaths[0]);
    await config
      .ensureProjectConfig(project.id)
      .catch((error: unknown) => log('warn', 'project-settings-unavailable', error));
    return project;
  });
  handleRequest<'refreshProject'>('textra:project:refresh', (id) => projects.refreshProject(id));
  handleRequest<'readFile'>('textra:file:read', (request) => projects.readFile(request));
  handleRequest<'saveFile'>('textra:file:save', async (request) => {
    const snapshot = await projects.saveFile(request);
    await externalEditor.noteLocalSave(snapshot);
    return snapshot;
  });
  handleRequest<'createEntry'>('textra:file:create', (request) => projects.createEntry(request));
  handleRequest<'renameEntry'>('textra:file:rename', async (request) => {
    requireIdleProject();
    await projects.resolvePath(request);
    validateRelativePath(request.newPath);
    // The renderer's named Rename action is the sole confirmation; a second
    // native dialog makes a simple rename needlessly repetitive.
    requireIdleProject();
    return projects.renameEntry(request);
  });
  handleRequest<'deleteEntry'>('textra:file:delete', async (request) => {
    requireIdleProject();
    await projects.resolvePath(request);
    const answer = await dialog.showMessageBox(requireWindow(), {
      type: 'warning',
      title: 'Move to trash',
      message: `Move “${request.path}” to the trash?`,
      detail:
        'Folders include all their contents. You can restore this item using your operating system.',
      buttons: ['Cancel', 'Move to trash'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1) return null;
    requireIdleProject();
    return projects.deleteEntry(request, (path) => shell.trashItem(path));
  });
  handleRequest<'getFileRevisions'>('textra:file:revisions', (request) =>
    projects.getFileRevisions(request),
  );
  handleRequest<'watchExternalFile'>('textra:file:watch-external', (request) =>
    externalEditor.watch(request),
  );
  handleRequest<'unwatchExternalFile'>('textra:file:unwatch-external', (request) => {
    externalEditor.unwatch(request);
  });
  handleRequest<'createConflictCopy'>('textra:file:create-conflict-copy', (request) =>
    externalEditor.createConflictCopy(request),
  );
  handleRequest<'revealEntry'>('textra:file:reveal', async (request) => {
    const target = await projects.resolvePath(request, true);
    const stats = await stat(target).catch(() => null);
    if (stats?.isDirectory()) {
      await shell.openPath(target);
    } else {
      shell.showItemInFolder(target);
    }
  });
  handleRequest<'openInCode'>('textra:file:code', async (request) =>
    openInExternalEditor(await projects.resolvePath(request, true)),
  );
  handle('textra:recent:get', 0, () => projects.getRecentProjects());
  handleRequest<'openRecentProject'>('textra:recent:open', async (id) => {
    requireIdleProject();
    externalEditor.clear();
    const project = await projects.openRecentProject(id);
    await config
      .ensureProjectConfig(project.id)
      .catch((error: unknown) => log('warn', 'project-settings-unavailable', error));
    return project;
  });
  handleRequest<'setProjectPinned'>('textra:recent:pin', (request) =>
    projects.setProjectPinned(request),
  );
  handleRequest<'cleanProjectBuildArtifacts'>('textra:build:clean-artifacts', async (projectId) => {
    if (builds.getState().running || healthBuild)
      throw new ProjectError('BUILD_RUNNING', 'Wait for the current build to finish first.');
    const root = projects.getRoot(projectId);
    const buildRoot = join(root, 'build');
    const managedBuild = join(buildRoot, 'textra');
    try {
      const buildInfo = await lstat(buildRoot);
      if (!buildInfo.isDirectory() || buildInfo.isSymbolicLink())
        throw new ProjectError('UNSAFE_PATH', 'The project build folder is not a safe directory.');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return { removed: false };
      throw error;
    }
    let info;
    try {
      info = await lstat(managedBuild);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return { removed: false };
      throw error;
    }
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new ProjectError('UNSAFE_PATH', 'The TeXtra build folder is not a safe directory.');
    const answer = await dialog.showMessageBox(requireWindow(), {
      type: 'warning',
      title: 'Clean TeXtra build files?',
      message: 'Remove generated PDFs, logs, and auxiliary files?',
      detail:
        'This removes only the project’s build/textra folder. Custom output folders and source files are preserved.',
      buttons: ['Cancel', 'Clean build files'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1) return { removed: false };
    if (builds.getState().running || healthBuild)
      throw new ProjectError(
        'BUILD_RUNNING',
        'A build started before cleanup could run. Try again when it finishes.',
      );
    await rm(managedBuild, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return { removed: true };
  });
  handleRequest<'cleanAuxiliaryFiles'>('textra:build:clean-aux', async (request) => {
    if (builds.getState().running || healthBuild)
      throw new ProjectError('BUILD_RUNNING', 'Wait for the current build to finish first.');
    const { projectId, path: docRelativePath } = request;
    const root = projects.getRoot(projectId);

    const AUX_EXTS = new Set([
      '.aux',
      '.bbl',
      '.blg',
      '.fls',
      '.fdb_latexmk',
      '.log',
      '.out',
      '.synctex',
      '.synctex.gz',
      '.toc',
      '.lof',
      '.lot',
      '.nav',
      '.snm',
      '.vrb',
      '.idx',
      '.ind',
      '.ilg',
      '.bcf',
      '.run.xml',
      '.xdv',
      '.dvi',
    ]);

    let baseName: string | null = null;
    let targetDir = root;
    if (docRelativePath) {
      const resolved = await projects.resolvePath({ projectId, path: docRelativePath });
      baseName = basename(resolved, extname(resolved));
      targetDir = dirname(resolved);
    }

    const candidateDirs = new Set<string>();
    candidateDirs.add(targetDir);
    candidateDirs.add(join(root, 'build', 'textra'));

    let removedCount = 0;
    for (const dir of candidateDirs) {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const fileName = entry.name;
          const lowerName = fileName.toLowerCase();
          if (
            lowerName.endsWith('.pdf') ||
            lowerName.endsWith('.tex') ||
            lowerName.endsWith('.bib')
          )
            continue;

          const ext = extname(lowerName);
          const isSynctexGz = lowerName.endsWith('.synctex.gz');
          const isAux = AUX_EXTS.has(ext) || isSynctexGz;
          if (!isAux) continue;

          if (baseName) {
            const matchesBase =
              lowerName.startsWith(baseName.toLowerCase() + '.') ||
              lowerName.startsWith(baseName.toLowerCase() + '-');
            if (!matchesBase && dir !== join(root, 'build', 'textra')) continue;
          }

          const filePath = join(dir, fileName);
          await unlink(filePath).catch(() => null);
          removedCount++;
        }
      } catch {
        // Directory may not exist
      }
    }

    return { removedCount };
  });
  handle('textra:dirty', 1, (value) => {
    if (typeof value !== 'boolean')
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid editor state.');
    dirty = value;
  });
  handle('textra:tools', 0, async () => [
    ...(await detectTools()),
    { name: 'vscode', path: await findCodeExecutable(), version: null },
  ]);
  handle('textra:language:status', 0, () => language.status());
  handle('textra:texlab:status', 0, () => texlab.status());
  handle('textra:texlab:check', 0, () => texlab.status(true));
  handleRequest<'syncTexlabDocument'>('textra:texlab:sync', async (request) => {
    await texlab.sync(request);
  });
  handleRequest<'texlabRequest'>('textra:texlab:request', (request) => texlab.request(request));
  handleRequest<'closeTexlabDocument'>('textra:texlab:close', (request) => texlab.close(request));
  handleRequest<'getTexlabDiagnostics'>('textra:texlab:diagnostics', (request) =>
    texlab.diagnosticsFor(request),
  );
  handleRequest<'lintLatex'>('textra:language:lint', (request) => language.lint(request));
  handleRequest<'formatLatex'>('textra:language:format', (request) => language.format(request));
  handle('textra:language:stackexchange', 1, async (query) => {
    if (typeof query !== 'string' || !query.trim() || query.length > 1_200)
      throw new ProjectError('INVALID_ARGUMENT', 'Provide a short error message to search.');
    const url = new URL('https://tex.stackexchange.com/search');
    url.searchParams.set('q', query.trim());
    await shell.openExternal(url.toString());
  });
  handle('textra:help:texfaq', 1, async (value) => {
    if (typeof value !== 'string' || value.length > 512)
      throw new ProjectError('INVALID_ARGUMENT', 'Choose a supported documentation article.');
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new ProjectError('INVALID_ARGUMENT', 'Choose a supported documentation article.');
    }
    const isTexFaq = url.hostname === 'texfaq.org' && /^\/FAQ-[A-Za-z0-9-]+$/.test(url.pathname);
    const isOverleaf =
      url.hostname === 'www.overleaf.com' &&
      /^\/(learn|how-to)\/[A-Za-z0-9_%.:/-]+$/.test(url.pathname);
    if (url.protocol !== 'https:' || (!isTexFaq && !isOverleaf) || url.search || url.hash)
      throw new ProjectError('INVALID_ARGUMENT', 'Choose a supported documentation article.');
    await shell.openExternal(url.toString());
  });
  handle('textra:clipboard:copy', 1, (text) => {
    if (typeof text !== 'string' || text.length > 512_000)
      throw new ProjectError('INVALID_ARGUMENT', 'Text is too large to copy.');
    clipboard.writeText(text);
  });
  handleRequest<'compile'>('textra:build:compile', async (request) => {
    if (healthBuild)
      throw new ProjectError('BUILD_RUNNING', 'Wait for the TeX setup test to finish.');
    if (dirty) throw new ProjectError('DIRTY_FILES', 'Save your edits before compiling.');
    const settings = request?.recipe
      ? validateRecipeSettings(await config.getProjectConfig(request.projectId))
      : undefined;
    return builds.compile(request, settings);
  });
  handle('textra:build:cancel', 0, async () => {
    await Promise.all([builds.cancel(), healthBuild?.cancel()]);
  });
  handle('textra:build:state', 0, () => builds.getState());
  handleRequest<'readPdf'>('textra:pdf:read', (request) => builds.readPdf(request));
  handleRequest<'readProjectPdf'>('textra:pdf:read-project', (request) =>
    projects.readProjectPdf(request),
  );
  handleRequest<'syncForward'>('textra:sync:forward', (request) => builds.syncForward(request));
  handleRequest<'syncInverse'>('textra:sync:inverse', (request) => builds.syncInverse(request));
  handleRequest<'getProjectConfig'>('textra:config:get', (id) => config.getProjectConfig(id));
  handleRequest<'setProjectConfig'>('textra:config:set', (request) =>
    config.setProjectConfig(request),
  );
  handleRequest<'copyEntryPath'>('textra:file:copy-path', async (request) => {
    if (!request || typeof request.relative !== 'boolean')
      throw new ProjectError('INVALID_ARGUMENT', 'Choose an absolute or relative project path.');
    const absolute = await projects.resolvePath(
      { projectId: request.projectId, path: request.path },
      true,
    );
    clipboard.writeText(request.relative ? request.path || '.' : absolute);
  });
  handle('textra:settings:export', 0, async () => {
    const content = exportSettings(await preferences.get());
    const result = await dialog.showSaveDialog(requireWindow(), {
      title: 'Export TeXtra settings',
      defaultPath: 'textra-settings.json',
      filters: [{ name: 'JSON settings', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    const temporary = join(dirname(result.filePath), `.textra-export-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(content, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, result.filePath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return true;
  });
  handle('textra:settings:import', 0, async () => {
    const selected = await dialog.showOpenDialog(requireWindow(), {
      title: 'Import TeXtra settings',
      properties: ['openFile'],
      filters: [{ name: 'JSON settings', extensions: ['json'] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    if ((await stat(selected.filePaths[0])).size > 1024 * 1024)
      throw new ProjectError('INVALID_SETTINGS', 'Settings files must be smaller than 1 MiB.');
    const next = importSettings(await readFile(selected.filePaths[0], 'utf8'));
    const answer = await dialog.showMessageBox(requireWindow(), {
      title: 'Import settings?',
      type: 'question',
      message: `Apply the ${next.theme} theme and saved pane layout?`,
      detail:
        'Your source files and recent project list are unchanged. No credentials are imported.',
      buttons: ['Cancel', 'Apply settings'],
      cancelId: 0,
      defaultId: 0,
    });
    if (answer.response !== 1) return null;
    const saved = await preferences.set(next);
    setToolPaths(saved.toolPaths);
    return saved;
  });
  handle('textra:setup:link', 1, async (target) => {
    const links = {
      miktex: 'https://miktex.org/download',
      texlive: 'https://tug.org/texlive/acquire-netinstall.html',
      mactex: 'https://tug.org/mactex/',
      latexindent: 'https://latexindentpl.readthedocs.io/en/latest/',
      chktexRules: 'https://www.nongnu.org/chktex/ChkTeX.pdf',
    };
    if (typeof target !== 'string' || !Object.hasOwn(links, target))
      throw new ProjectError('INVALID_ARGUMENT', 'Unknown setup destination.');
    await shell.openExternal(links[target as keyof typeof links]);
  });
  handle('textra:setup:test', 0, async () => {
    if (healthBuild || builds.getState().running)
      throw new ProjectError('BUILD_RUNNING', 'Wait for the current build to finish.');
    const directory = await mkdtemp(join(app.getPath('temp'), 'textra-toolcheck-'));
    const checker = new BuildService(() => directory, 30000);
    healthBuild = checker;
    try {
      await writeFile(
        join(directory, 'main.tex'),
        '\\documentclass{article}\n\\begin{document}\nTeXtra setup test.\n\\end{document}\n',
      );
      const result = await checker.compile({
        projectId: 'setup-test',
        rootFile: 'main.tex',
        engine: 'pdflatex',
      });
      return { success: result.outcome === 'success', log: result.log };
    } finally {
      healthBuild = null;
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  log('info', 'application-ready', { version: app.getVersion() });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => {
  agent.cancel();
  ai.cancel();
  externalEditor.clear();
  void builds.cancel();
  void texlab.stop();
});
