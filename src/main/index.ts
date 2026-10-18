import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRODUCT_NAME, type Result } from '../shared/api';
import { isTrustedRendererUrl } from './security';
import { log } from './services/logger';
import { PreferencesStore } from './services/preferences';

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
    } catch {
      // Raw errors can contain local paths or private preference data.
      log('warn', 'ipc-request-failed', { channel });
      return {
        ok: false,
        error: 'The request could not be completed. Existing data was preserved.',
      };
    }
  });
}

function createWindow(): void {
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
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  const loading = developmentUrl ? window.loadURL(developmentUrl) : window.loadFile(rendererFile);
  void loading.catch(() => log('error', 'renderer-load-failed'));
}

void app.whenReady().then(() => {
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
  handle('textra:preferences:get', 0, () => preferences.get());
  handle('textra:preferences:set', 1, (value) => preferences.set(value));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  log('info', 'application-ready', { version: app.getVersion() });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
