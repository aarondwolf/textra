import { app, BrowserWindow, dialog, session, safeStorage } from 'electron';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, lstat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isTrustedRendererUrl } from './security';
import { log } from './services/logger';
import { PreferencesStore } from './services/preferences';
import { ProjectError, ProjectService } from './services/projects';
import { ExternalEditorService } from './services/external-editor';
import { HistoryService } from './services/history';
import { BuildService } from './services/latex';
import { planRecipe } from './services/recipe-plan';
import { ConfigService } from './services/settings';
import { validateRecipeSettings } from '../shared/recipes';
import { LanguageService } from './services/language';
import { TexlabManager } from './services/texlab-manager';
import { AIService } from './services/ai-service';
import { AIInlineEditService } from './services/ai-inline-edit';
import { BoundedAgentService } from './services/agent';
import { AgentWorkspaceService } from './services/agent-workspace';
import { AI_PROVIDERS } from '../shared/ai';
import { AIChatStore } from './services/ai-chats';
import { ProjectConflictPolicyService } from './services/project-conflict-policy';
import { CollaborationStorage } from './services/collaboration-storage';
import { registerApplicationIpc, type RuntimeState } from './ipc';
import {
  ApplicationTasks,
  RendererCloseBarrier,
  ShutdownCoordinator,
  WorkspaceSession,
} from './lifecycle';
import { createSecureWindow } from './window';

const directory = dirname(fileURLToPath(import.meta.url));
const rendererFile = join(directory, '../renderer/index.html');
const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const rendererUrl = developmentUrl ?? pathToFileURL(rendererFile).href;
if (!isTrustedRendererUrl(rendererUrl, rendererUrl)) {
  throw new Error('The development renderer must use a local HTTP address.');
}

const testUserData = !app.isPackaged ? process.env.TEXTRA_USER_DATA_DIR : undefined;
let mainWindow: BrowserWindow | null = null;
const preferences = new PreferencesStore(app.getPath('userData'));
const aiUserDataDir = join(app.getPath('userData'), 'ai');

async function migrateLegacyAI(): Promise<void> {
  if (app.isPackaged || testUserData) return;
  const legacyDirectory = join(app.getAppPath(), '.textra-local');
  try {
    const directoryInfo = await lstat(legacyDirectory);
    const source = join(legacyDirectory, 'ai.json');
    const sourceInfo = await lstat(source);
    if (
      !directoryInfo.isDirectory() ||
      directoryInfo.isSymbolicLink() ||
      !sourceInfo.isFile() ||
      sourceInfo.isSymbolicLink() ||
      sourceInfo.nlink > 1 ||
      sourceInfo.size > 1024 * 1024
    )
      return;
    await mkdir(aiUserDataDir, { recursive: true });
    const destinationInfo = await lstat(aiUserDataDir);
    if (!destinationInfo.isDirectory() || destinationInfo.isSymbolicLink()) return;
    await copyFile(source, join(aiUserDataDir, 'ai.json'), constants.COPYFILE_EXCL);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      ['ENOENT', 'EEXIST'].includes(String(error.code))
    )
      return;
    log('warn', 'legacy-ai-migration-unavailable');
  }
}
const ai = new AIService(
  aiUserDataDir,
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
const conflictPolicy = new ProjectConflictPolicyService(app.getPath('userData'), (id) =>
  projects.getRoot(id),
);
const collaboration = new CollaborationStorage(
  (id) => projects.getRoot(id),
  app.getPath('userData'),
  (ref) => projects.readFile(ref),
);
const inlineEdits = new AIInlineEditService(ai);
const agent = new BoundedAgentService(ai);
const agentWorkspace = new AgentWorkspaceService(projects, agent);
const aiChats = new AIChatStore(join(app.getPath('userData'), 'ai-chats'), (id) =>
  projects.getRoot(id),
);
const externalEditor = new ExternalEditorService(projects);
const history = new HistoryService(projects, app.getPath('userData'));
const builds = new BuildService((id) => projects.getRoot(id), 120_000, app.getPath('userData'));
const config = new ConfigService(app.getPath('userData'), (id) => projects.getRoot(id));
const language = new LanguageService(
  projects,
  () => preferences.get(),
  async (projectId, path) => {
    const root = projects.getRoot(projectId);
    const relDoc = path.replace(/\.tex$/i, '');
    let buildDir = join(root, 'build', 'textra', ...relDoc.split(/[\\/]/));
    try {
      const rawConfig = await config.getProjectConfig(projectId);
      const settings = validateRecipeSettings(rawConfig);
      const recipeName =
        rawConfig?.recipes?.[path] || settings['latex-workshop.latex.recipes']?.[0]?.name;
      if (recipeName) {
        const plan = await planRecipe(root, path, recipeName, settings).catch(() => null);
        if (plan?.auxiliary) {
          buildDir = plan.auxiliary;
        } else if (plan?.output) {
          buildDir = plan.output;
        }
      }
    } catch {
      /* Fall back to default build folder */
    }
    return buildDir;
  },
);
const texlab = new TexlabManager(
  projects,
  app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources'),
  async () => (await preferences.get()).texlabEnabled,
);
const state: RuntimeState = {
  dirty: false,
  stopping: false,
  healthBuild: null,
  healthCheckStarting: false,
};

function requireIdleProject(): void {
  if (builds.getState().running || state.healthBuild || state.healthCheckStarting)
    throw new ProjectError(
      'BUILD_RUNNING',
      'Cancel the current build before changing projects or files.',
    );
  if (state.dirty)
    throw new ProjectError('DIRTY_FILES', 'Save or explicitly discard your unsaved edits first.');
}

function requireWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed())
    throw new ProjectError('NO_WINDOW', 'The application window is no longer available.');
  return mainWindow;
}

async function flushPersistence(): Promise<void> {
  await Promise.all([
    preferences.flush(),
    projects.flush(),
    config.flush(),
    aiChats.flush(),
    history.flush(),
  ]);
}

const closeBarrier = new RendererCloseBarrier();
const applicationTasks = new ApplicationTasks();
const workspace = new WorkspaceSession(async () => {
  agent.cancel();
  ai.cancelAll();
  externalEditor.clear();
  await agentWorkspace.sync(null);
  await Promise.all([builds.cancel(), state.healthBuild?.cancel(), language.stop(), texlab.stop()]);
});

export async function focusOrCreateWindow(): Promise<void> {
  await initialized;
  if (quitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  const window = requireWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createWindow(): void {
  if (quitting) return;
  workspace.resume();
  state.stopping = false;
  const window = createSecureWindow({
    resourcesRoot: app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources'),
    preload: join(directory, '../preload/index.cjs'),
    rendererUrl,
  });
  const shutdown = new ShutdownCoordinator();
  let closeAttempt: Promise<void> | null = null;
  let rendererAvailable = true;
  window.webContents.on('render-process-gone', () => {
    rendererAvailable = false;
  });
  window.webContents.on('did-finish-load', () => {
    rendererAvailable = true;
  });
  const confirmUnavailableRenderer = async () => {
    const answer = await dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Close TeXtra after renderer failure?',
      message: 'The editor stopped responding. Close TeXtra?',
      detail:
        'Unsaved editor text and pending settings could not be confirmed. Closing may lose those changes. Already started file writes will finish before exit.',
      buttons: ['Keep open', 'Close TeXtra'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return answer.response === 1;
  };
  mainWindow = window;
  window.on('close', (event) => {
    if (shutdown.ready) return;
    event.preventDefault();
    if (closeAttempt) return;
    closeAttempt = shutdown
      .request(
        async () => {
          if (!rendererAvailable) return confirmUnavailableRenderer();
          const ready = await closeBarrier.wait(randomUUID(), (id) =>
            window.webContents.send('textra:before-close', id),
          );
          if (!ready) {
            if (!rendererAvailable) return confirmUnavailableRenderer();
            throw new Error('Renderer persistence did not finish.');
          }
          if (state.dirty || builds.getState().running || state.healthBuild) {
            const { response } = await dialog.showMessageBox(window, {
              type: 'warning',
              title: 'Close TeXtra?',
              message: state.dirty
                ? 'Discard unsaved edits and close TeXtra?'
                : 'Stop the running build and close TeXtra?',
              detail:
                'Changes that have not been saved will be lost. Any running build will be stopped.',
              buttons: ['Keep working', 'Close'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            });
            if (response !== 1) return false;
          }
          return true;
        },
        async () => {
          state.stopping = true;
          await workspace.stop();
          await applicationTasks.drain();
          await flushPersistence();
        },
      )
      .then((ready) => {
        if (ready) {
          state.dirty = false;
          if (!window.isDestroyed()) window.close();
        } else if (!window.isDestroyed()) window.webContents.send('textra:close-cancelled');
      })
      .catch(() => {
        state.stopping = false;
        workspace.resume();
        log('error', 'close-cleanup-failed');
        if (!window.isDestroyed()) {
          window.webContents.send('textra:close-cancelled');
          void dialog.showMessageBox(window, {
            type: 'error',
            title: 'TeXtra is still open',
            message:
              'Pending changes could not be saved. Keep working and retry closing after resolving the save error.',
          });
        }
      })
      .finally(() => {
        closeAttempt = null;
      });
  });
  window.on('closed', () => {
    closeBarrier.cancel();
    if (mainWindow === window) mainWindow = null;
  });
  const loading = developmentUrl ? window.loadURL(developmentUrl) : window.loadFile(rendererFile);
  void loading.catch(() => {
    rendererAvailable = false;
    log('error', 'renderer-load-failed');
  });
}

const initialized = app.whenReady().then(async () => {
  await migrateLegacyAI();
  externalEditor.onChange((change) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('textra:file:external-change', change);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.on('will-download', (event) => event.preventDefault());
  registerApplicationIpc({
    preferences,
    projects,
    conflictPolicy,
    collaboration,
    ai,
    inlineEdits,
    agentWorkspace,
    aiChats,
    externalEditor,
    history,
    builds,
    config,
    language,
    texlab,
    state,
    workspace,
    applicationTasks,
    closeBarrier,
    rendererUrl,
    requireWindow,
    requireIdleProject,
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  log('info', 'application-ready', { version: app.getVersion() });
});
void initialized.catch(() => {
  log('error', 'application-initialization-failed');
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
// Cmd+Q with no open macOS window must still await application-owned work.
let quitReady = false;
let quitting: Promise<void> | null = null;
app.on('before-quit', (event) => {
  if (quitReady || mainWindow) return;
  event.preventDefault();
  quitting ??= (async () => {
    state.stopping = true;
    await workspace.stop();
    await applicationTasks.drain();
    await flushPersistence();
    quitReady = true;
    app.quit();
  })().catch(() => {
    quitting = null;
    state.stopping = false;
    workspace.resume();
    log('error', 'quit-cleanup-failed');
  });
});
