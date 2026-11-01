import { app, dialog, ipcMain, shell, clipboard, type IpcMainInvokeEvent } from 'electron';
import { basename, dirname, extname, join } from 'node:path';
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
import {
  CONFIGURABLE_TOOLS,
  PRODUCT_NAME,
  type ConfigurableTool,
  type Result,
  type TextraAPI,
} from '../shared/api';
import { isTrustedRendererUrl } from './security';
import { registerAiIpc } from './ipc/ai';
import type { IpcServices } from './ipc/types';
export type { RuntimeState } from './ipc/types';
import { readWindowState } from './window';
import { log } from './services/logger';
import { shouldLogIpcFailure } from './services/ipc-logging';
import { ProjectError, validateRelativePath } from './services/projects';
import { findCodeExecutable, openInExternalEditor } from './services/external-editor';
import { BuildService, detectTools } from './services/latex';
import { planRecipe } from './services/recipe-plan';
import { setToolPaths, validateToolPath } from './services/tool-paths';
import { exportSettings, importSettings } from './services/settings';
import { validateRecipeSettings } from '../shared/recipes';
import { TexlabError } from './services/texlab';
import { AIError } from './services/ai-service';

import { LifecycleError } from './lifecycle';
function isControlChannel(channel: string): boolean {
  return channel === 'textra:close:ack' || channel.endsWith(':cancel');
}
function isWorkspaceChannel(channel: string): boolean {
  return (
    /^(?:textra:(?:file|build|pdf|sync|config|history|texlab|agent):|textra:ai:chats:)/.test(
      channel,
    ) ||
    [
      'textra:project:refresh',
      'textra:project:directory',
      'textra:project:prepare',
      'textra:project:conflict-policy:get',
      'textra:project:conflict-policy:set',
      'textra:collaboration:records',
      'textra:ai:completion:request',
      'textra:ai:inline-edit:request',
      'textra:ai:assistant:run',
      'textra:language:lint',
      'textra:language:format',
      'textra:setup:test',
    ].includes(channel)
  );
}
/** Fixed capabilities; senders and runtime inputs are validated in main. */
export function registerApplicationIpc(services: IpcServices): void {
  const {
    preferences,
    projects,
    conflictPolicy,
    collaboration,
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
  } = services;
  function errorResult(error: unknown): { ok: false; error: string; code: string } {
    if (error instanceof AIError) return { ok: false, error: error.message, code: error.code };
    if (
      error instanceof LifecycleError ||
      error instanceof ProjectError ||
      (error instanceof Error && error.name === 'SettingsError')
    )
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
      return {
        ok: false,
        code: 'NOT_FOUND',
        error: 'The selected file or folder no longer exists.',
      };
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
    const mainWindow = requireWindow();
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
        if (state.stopping && !isControlChannel(channel))
          throw new LifecycleError('APP_CLOSING', 'TeXtra is finishing its pending work.');
        const invoke = () => action(...args);
        const value = isControlChannel(channel)
          ? await invoke()
          : await applicationTasks.run(() =>
              isWorkspaceChannel(channel) ? workspace.run(invoke) : invoke(),
            );
        return { ok: true, value };
      } catch (error) {
        // Raw errors can contain local paths or private preference data.
        const result = errorResult(error);
        if (shouldLogIpcFailure(channel, result.code))
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

  handle('textra:app-info', 0, () => ({
    name: PRODUCT_NAME,
    version: app.getVersion(),
    platform: process.platform,
  }));
  registerAiIpc({ handle, handleRequest }, services);
  handle('textra:preferences:get', 0, () => preferences.get());
  handleRequest<'getProjectConflictPolicy'>('textra:project:conflict-policy:get', (id) =>
    conflictPolicy.get(id),
  );
  handleRequest<'setProjectConflictPolicy'>('textra:project:conflict-policy:set', (request) =>
    conflictPolicy.set(request.projectId, request.policy),
  );
  handle('textra:window:get', 0, () => readWindowState(requireWindow()));
  handle('textra:window:control', 1, (action) => {
    if (action !== 'minimize' && action !== 'toggle-maximize' && action !== 'close')
      throw new ProjectError('INVALID_ARGUMENT', 'Choose a supported window action.');
    const window = requireWindow();
    if (action === 'minimize') window.minimize();
    else if (action === 'toggle-maximize') {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else window.close(); // The existing close handler owns persistence and discard confirmation.
  });
  void preferences
    .get()
    .then((saved) => {
      setToolPaths(saved.toolPaths);
    })
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
    return workspace.transition(() => {
      requireIdleProject();
      return projects.openRoot(result.filePaths[0], { initialTree: true });
    });
  });
  handleRequest<'refreshProject'>('textra:project:refresh', (id) => projects.refreshProject(id));
  handleRequest<'listProjectDirectory'>('textra:project:directory', (request) =>
    projects.listDirectory(request),
  );
  handleRequest<'prepareProject'>('textra:project:prepare', async (id) => {
    await config.ensureProjectConfig(id);
    await history.prune(id);
    await collaboration.recoverOutbox(id);
  });
  handleRequest<'readFile'>('textra:file:read', (request) => projects.readFile(request));
  handleRequest<'readReferenceCandidate'>('textra:file:read-reference-candidate', (request) =>
    projects.readFile(request),
  );
  handleRequest<'saveFile'>('textra:file:save', async (request) => {
    const outbox = request.collaboration
      ? await collaboration.prepareOutbox(request, request.collaboration, request.content)
      : null;
    const snapshot = await projects.saveFile(request);
    await externalEditor.noteLocalSave(snapshot);
    if (outbox && request.collaboration) {
      try {
        await collaboration.publish(request, request.collaboration, request.content);
        await collaboration.acknowledgeOutbox(outbox);
      } catch (err) {
        log('warn', 'collaboration-publication-pending', { code: errorResult(err).code });
        return { ...snapshot, synchronizationPending: true };
      }
    }
    const prefs = await preferences.get();
    if (prefs.historyEnabled) {
      await history
        .create({ ...request, trigger: 'save' })
        .catch((err) =>
          log('warn', 'history-save-snapshot-failed', { code: errorResult(err).code }),
        );
    }
    return snapshot;
  });
  handleRequest<'getCollaborationRecords'>('textra:collaboration:records', (request) =>
    collaboration.list(request),
  );
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
  handle('textra:close:ack', 1, (request) => closeBarrier.acknowledge(request));
  handleRequest<'listLegacyFileHistories'>('textra:history:legacy:list', (id) =>
    history.listLegacy(id),
  );
  handleRequest<'importLegacyFileHistory'>('textra:history:legacy:import', async (request) => {
    const candidate = (await history.listLegacy(request?.projectId)).find(
      (store) => store.id === request?.legacyId,
    );
    if (!candidate)
      throw new ProjectError('NOT_FOUND', 'Choose a legacy history store from the recovery list.');
    const result = await dialog.showMessageBox(requireWindow(), {
      type: 'question',
      title: 'Recover file history?',
      message: `Import ${candidate.snapshotCount} historical snapshots into this project?`,
      detail:
        'Legacy history has no recorded project identity. Verify these paths belong to this project:\n' +
        candidate.samplePaths.join('\n') +
        '\nThe original history store will be preserved.',
      buttons: ['Cancel', 'Import history'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return result.response === 1 ? history.importLegacy(request) : 0;
  });
  handleRequest<'cancelLanguageRequest'>('textra:language:cancel', (request) =>
    language.cancel(request),
  );
  handleRequest<'listFileHistory'>('textra:history:list', (request) => history.list(request));
  handleRequest<'readFileHistorySnapshot'>('textra:history:read', (request) =>
    history.read(request),
  );
  handleRequest<'createFileHistorySnapshot'>('textra:history:create', (request) =>
    history.create(request),
  );
  handleRequest<'restoreFileHistorySnapshot'>('textra:history:restore', async (request) => {
    const snapshot = await history.restore(request);
    await externalEditor.noteLocalSave(snapshot);
    return snapshot;
  });
  handleRequest<'pinFileHistorySnapshot'>('textra:history:pin', (request) => history.pin(request));
  handleRequest<'exportFileHistorySnapshot'>('textra:history:export', (request) =>
    history.exportSnapshot(request, requireWindow()),
  );
  handleRequest<'deleteFileHistorySnapshot'>('textra:history:delete', (request) =>
    history.deleteSnapshot(request),
  );
  handle('textra:recent:get', 0, () => projects.getRecentProjects());
  handleRequest<'openRecentProject'>('textra:recent:open', async (id) => {
    requireIdleProject();
    return workspace.transition(() => {
      requireIdleProject();
      return projects.openRecentProject(id, { initialTree: true });
    });
  });
  handleRequest<'setProjectPinned'>('textra:recent:pin', (request) =>
    projects.setProjectPinned(request),
  );
  handleRequest<'cleanProjectBuildArtifacts'>('textra:build:clean-artifacts', async (projectId) => {
    if (builds.getState().running || state.healthBuild)
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
    if (builds.getState().running || state.healthBuild)
      throw new ProjectError(
        'BUILD_RUNNING',
        'A build started before cleanup could run. Try again when it finishes.',
      );
    await rm(managedBuild, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return { removed: true };
  });
  handleRequest<'cleanAuxiliaryFiles'>('textra:build:clean-aux', async (request) => {
    if (builds.getState().running || state.healthBuild)
      throw new ProjectError('BUILD_RUNNING', 'Wait for the current build to finish first.');
    const { projectId, path: docRelativePath, recipe: requestedRecipe } = request;
    if (!docRelativePath || !/\.tex$/i.test(docRelativePath)) {
      return { removedCount: 0 };
    }
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
      '.upa',
      '.upb',
      '.auxlock',
      '.dpth',
      '.mw',
      '.ent',
      '.cut',
    ]);

    const resolved = await projects.resolvePath({ projectId, path: docRelativePath });
    const baseName = basename(resolved, extname(resolved));
    const lowerBase = baseName.toLowerCase();
    const targetDir = dirname(resolved);
    const relDoc = docRelativePath.replace(/\.tex$/i, '');
    const docBuildDir = join(root, 'build', 'textra', ...relDoc.split(/[\\/]/));

    const shallowDirs = new Set<string>([targetDir]);
    const dedicatedBuildDirs = new Set<string>([docBuildDir]);

    try {
      const rawConfig = await config.getProjectConfig(projectId);
      const settings = validateRecipeSettings(rawConfig);
      const recipeName =
        requestedRecipe ||
        rawConfig?.recipes?.[docRelativePath] ||
        settings['latex-workshop.latex.recipes']?.[0]?.name;
      if (recipeName) {
        const plan = await planRecipe(root, docRelativePath, recipeName, settings).catch(
          () => null,
        );
        if (plan) {
          for (const dir of [plan.auxiliary, plan.output]) {
            if (dir === root || dir === targetDir || dir === join(root, 'build', 'textra')) {
              shallowDirs.add(dir);
            } else {
              dedicatedBuildDirs.add(dir);
            }
          }
        }
      }
    } catch {
      // Fall back to standard candidate directories
    }

    function isSafeAuxFile(fileName: string, requireBaseMatch: boolean): boolean {
      const lowerName = fileName.toLowerCase();
      if (
        lowerName.endsWith('.pdf') ||
        lowerName.endsWith('.tex') ||
        lowerName.endsWith('.bib') ||
        lowerName.endsWith('.cls') ||
        lowerName.endsWith('.sty') ||
        lowerName.endsWith('.dtx') ||
        lowerName.endsWith('.ins')
      )
        return false;

      const ext = extname(lowerName);
      const isSynctexGz = lowerName.endsWith('.synctex.gz');
      const isAux = AUX_EXTS.has(ext) || isSynctexGz;
      if (!isAux) return false;

      if (requireBaseMatch) {
        const matchesBase =
          lowerName.startsWith(lowerBase + '.') || lowerName.startsWith(lowerBase + '-');
        if (!matchesBase) return false;
      }

      return true;
    }

    async function collectShallowMatchingAuxFiles(dir: string): Promise<string[]> {
      const collected: string[] = [];
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && isSafeAuxFile(entry.name, true)) {
            collected.push(join(dir, entry.name));
          }
        }
      } catch {
        // Directory may not exist or not readable
      }
      return collected;
    }

    async function collectDedicatedDirAuxFiles(dir: string, depth = 0): Promise<string[]> {
      if (depth > 4) return [];
      const collected: string[] = [];
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            const lowerDir = entry.name.toLowerCase();
            if (['.git', 'node_modules', '.textra', '.agents', '.codex'].includes(lowerDir))
              continue;
            collected.push(...(await collectDedicatedDirAuxFiles(fullPath, depth + 1)));
          } else if (entry.isFile() && isSafeAuxFile(entry.name, true)) {
            collected.push(fullPath);
          }
        }
      } catch {
        // Directory may not exist or not readable
      }
      return collected;
    }

    const filesToDelete = new Set<string>();
    for (const dir of shallowDirs) {
      const files = await collectShallowMatchingAuxFiles(dir);
      for (const f of files) filesToDelete.add(f);
    }
    for (const dir of dedicatedBuildDirs) {
      const files = await collectDedicatedDirAuxFiles(dir);
      for (const f of files) filesToDelete.add(f);
    }

    let removedCount = 0;
    for (const file of filesToDelete) {
      try {
        await unlink(file);
        removedCount++;
      } catch {
        // Ignore unlinking errors
      }
    }

    return { removedCount };
  });
  handle('textra:dirty', 1, (value) => {
    if (typeof value !== 'boolean')
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid editor state.');
    state.dirty = value;
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
    const generation = workspace.generation;
    if (state.healthBuild || state.healthCheckStarting)
      throw new ProjectError('BUILD_RUNNING', 'Wait for the TeX setup test to finish.');
    if (state.dirty) throw new ProjectError('DIRTY_FILES', 'Save your edits before compiling.');
    const prefs = await preferences.get();
    if (prefs.historyEnabled && request?.rootFile) {
      await history
        .createFromDisk({
          projectId: request.projectId,
          path: request.rootFile,
          trigger: 'compile',
        })
        .catch((err) =>
          log('warn', 'history-compile-snapshot-failed', { code: errorResult(err).code }),
        );
    }
    const settings = request?.recipe
      ? validateRecipeSettings(await config.getProjectConfig(request.projectId))
      : undefined;
    workspace.assertCurrent(generation);
    return builds.compile(request, settings, prefs.miktexAutoInstall);
  });
  handle('textra:build:cancel', 0, async () => {
    await Promise.all([builds.cancel(), state.healthBuild?.cancel()]);
  });
  handle('textra:build:state', 0, () => builds.getState());
  handleRequest<'readPdf'>('textra:pdf:read', (request) => builds.readPdf(request));
  handleRequest<'restoreLastPdf'>('textra:pdf:restore', (id) => builds.restoreLastPdf(id));
  handleRequest<'readProjectPdf'>('textra:pdf:read-project', (request) =>
    projects.readProjectPdf(request),
  );
  handleRequest<'readProjectPdfCandidate'>('textra:pdf:read-project-candidate', (request) =>
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
  handle('textra:appdata:open', 0, async () => {
    await shell.openPath(app.getPath('userData'));
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
    if (state.healthBuild || state.healthCheckStarting || builds.getState().running)
      throw new ProjectError('BUILD_RUNNING', 'Wait for the current build to finish.');
    const generation = workspace.generation;
    state.healthCheckStarting = true;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(app.getPath('temp'), 'textra-toolcheck-'));
      const root = directory;
      const checker = new BuildService(() => root, 30000);
      state.healthBuild = checker;
      await writeFile(
        join(directory, 'main.tex'),
        '\\documentclass{article}\n\\begin{document}\nTeXtra setup test.\n\\end{document}\n',
      );
      workspace.assertCurrent(generation);
      const result = await checker.compile({
        projectId: 'setup-test',
        rootFile: 'main.tex',
        engine: 'pdflatex',
      });
      return { success: result.outcome === 'success', log: result.log };
    } finally {
      state.healthBuild = null;
      state.healthCheckStarting = false;
      if (directory)
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
}
