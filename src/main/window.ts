import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { PRODUCT_NAME, type WindowState } from '../shared/api';
import { isTrustedRendererUrl } from './security';
import { log } from './services/logger';
export function readWindowState(window: BrowserWindow): WindowState {
  return { maximized: window.isMaximized(), customControls: process.platform !== 'darwin' };
}

export function createSecureWindow(options: {
  resourcesRoot: string;
  preload: string;
  rendererUrl: string;
}): BrowserWindow {
  const { rendererUrl } = options;
  const windowIcon = join(
    options.resourcesRoot,
    process.platform === 'win32' ? 'icon.ico' : 'icon.png',
  );
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    icon: windowIcon,
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 640,
    show: false,
    backgroundColor: '#1c1e20',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  window.removeMenu();
  const publishWindowState = () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send('textra:window:state', readWindowState(window));
  };
  window.on('maximize', publishWindowState);
  window.on('unmaximize', publishWindowState);
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
  return window;
}
