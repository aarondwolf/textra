import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { PRODUCT_NAME, type Preferences } from '../shared/api';
import { isTrustedRendererUrl } from './security';
import { log } from './services/logger';
const TITLEBAR_OVERLAY_HEIGHT = 31;
const BUILT_IN_THEME_OVERLAY_COLORS: Record<string, { color: string; symbolColor: string }> = {
  dark: { color: '#202224', symbolColor: '#979c9e' },
  light: { color: '#efeee9', symbolColor: '#636c67' },
  midnight: { color: '#181c2d', symbolColor: '#a5aec5' },
  forest: { color: '#1c2821', symbolColor: '#a0b2a3' },
  ocean: { color: '#182a31', symbolColor: '#9fbac0' },
  rose: { color: '#2d1d29', symbolColor: '#c5a4b5' },
  sand: { color: '#e8deca', symbolColor: '#716756' },
};

export function applyTitleBarOverlay(window: BrowserWindow | null, saved: Preferences): void {
  if (!window || window.isDestroyed() || typeof window.setTitleBarOverlay !== 'function') {
    return;
  }
  const custom = saved.customThemes?.find((t) => t.id === saved.theme);
  const baseKey = custom ? custom.baseTheme : saved.theme;
  const base = BUILT_IN_THEME_OVERLAY_COLORS[baseKey] ?? BUILT_IN_THEME_OVERLAY_COLORS.dark;
  const color = base.color;
  const symbolColor = saved.themeCustomizations.text || custom?.text || base.symbolColor;
  try {
    window.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_OVERLAY_HEIGHT });
  } catch {
    // Ignore on platforms where titleBarOverlay is unsupported
  }
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
    titleBarOverlay: {
      color: '#202224',
      symbolColor: '#979c9e',
      height: TITLEBAR_OVERLAY_HEIGHT,
    },
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
