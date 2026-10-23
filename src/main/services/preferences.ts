import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BUILD_RECIPES,
  CONFIGURABLE_TOOLS,
  DEFAULT_PREFERENCES,
  FONT_SIZE_RANGE,
  SIDEBAR_WIDTH_RANGE,
  type ConfigurableTool,
  type Preferences,
} from '../../shared/api';
import { validateToolPath } from './tool-paths';

const preferenceKeys = Object.keys(DEFAULT_PREFERENCES);
// Added after version 1 shipped; older files without them migrate to defaults.
const optionalKeys = new Set([
  'defaultRecipe',
  'themeCustomizations',
  'previewVisible',
  'fontSize',
  'wrap',
  'autoSave',
  'autoSaveDelayMs',
  'editorMinimap',
  'commonProblemHelp',
  'formatToolbarVisible',
  'sidebarWidth',
  'texlabEnabled',
  'chktexEnabled',
  'chktexRunMode',
  'chktexIgnoredRules',
  'chktexRuleSeverities',
  'toolPaths',
  'restoreSession',
  'tabCloseButtons',
  'previewTabs',
  'recentCommands',
  // External-change protection was introduced after the original preferences schema.
  'externalChangeDetection',
  'externalChangeQuietPeriodMs',
  'externalChangePollingOnly',
  'openDiffAfterConflictCopy',
  'uiFont',
  'editorFont',
  'customThemes',
  'keyboardShortcuts',
  'snippetsSymbolsOpenDefault',
  'snippetsTemplatesOpenDefault',
  'historyEnabled',
  'historyIntervalMinutes',
]);

const themeNames = new Set(['dark', 'light', 'midnight', 'forest', 'ocean', 'rose', 'sand']);
const colorPattern = /^#[0-9a-fA-F]{6}$/;

function validateCustomThemes(value: unknown): Preferences['customThemes'] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Unsupported or invalid preferences.');
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      throw new Error('Unsupported or invalid preferences.');
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== 'string' ||
      !candidate.id ||
      candidate.id.length > 64 ||
      typeof candidate.name !== 'string' ||
      !candidate.name ||
      candidate.name.length > 64 ||
      typeof candidate.baseTheme !== 'string' ||
      !themeNames.has(candidate.baseTheme)
    )
      throw new Error('Unsupported or invalid preferences.');
    return {
      id: candidate.id,
      name: candidate.name,
      baseTheme: candidate.baseTheme as 'dark' | 'light',
      ...(typeof candidate.accent === 'string' && colorPattern.test(candidate.accent)
        ? { accent: candidate.accent }
        : {}),
      ...(typeof candidate.accentStrong === 'string' && colorPattern.test(candidate.accentStrong)
        ? { accentStrong: candidate.accentStrong }
        : {}),
      ...(typeof candidate.accentBackground === 'string' &&
      colorPattern.test(candidate.accentBackground)
        ? { accentBackground: candidate.accentBackground }
        : {}),
      ...(typeof candidate.background === 'string' && colorPattern.test(candidate.background)
        ? { background: candidate.background }
        : {}),
      ...(typeof candidate.surface === 'string' && colorPattern.test(candidate.surface)
        ? { surface: candidate.surface }
        : {}),
      ...(typeof candidate.text === 'string' && colorPattern.test(candidate.text)
        ? { text: candidate.text }
        : {}),
      ...(typeof candidate.uiFont === 'string' ? { uiFont: candidate.uiFont.slice(0, 128) } : {}),
      ...(typeof candidate.editorFont === 'string'
        ? { editorFont: candidate.editorFont.slice(0, 128) }
        : {}),
    };
  });
}

function validateKeyboardShortcuts(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Unsupported or invalid preferences.');
  const record = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(record)) {
    if (typeof key === 'string' && typeof val === 'string' && key.length < 64 && val.length < 64) {
      result[key] = val;
    }
  }
  return result;
}

function validateThemeCustomizations(value: unknown): Preferences['themeCustomizations'] {
  if (value === undefined) return { ...DEFAULT_PREFERENCES.themeCustomizations };
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Unsupported or invalid preferences.');
  const candidate = value as Record<string, unknown>;
  if (
    !['accent', 'accentStrong', 'accentBackground'].every((key) => Object.hasOwn(candidate, key)) ||
    !Object.entries(candidate).every(
      ([k, color]) =>
        ['accent', 'accentStrong', 'accentBackground', 'background', 'surface', 'text'].includes(
          k,
        ) &&
        typeof color === 'string' &&
        colorPattern.test(color),
    )
  )
    throw new Error('Unsupported or invalid preferences.');
  return {
    accent: candidate.accent as string,
    accentStrong: candidate.accentStrong as string,
    accentBackground: candidate.accentBackground as string,
    ...(typeof candidate.background === 'string' && colorPattern.test(candidate.background)
      ? { background: candidate.background }
      : {}),
    ...(typeof candidate.surface === 'string' && colorPattern.test(candidate.surface)
      ? { surface: candidate.surface }
      : {}),
    ...(typeof candidate.text === 'string' && colorPattern.test(candidate.text)
      ? { text: candidate.text }
      : {}),
  };
}

function validateRecentCommands(value: unknown): Preferences['recentCommands'] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12)
    throw new Error('Unsupported or invalid preferences.');
  if (
    !value.every(
      (command) => typeof command === 'string' && command.length > 0 && command.length <= 100,
    )
  )
    throw new Error('Unsupported or invalid preferences.');
  return [...new Set(value)];
}

function validateChktexIgnoredRules(value: unknown): Preferences['chktexIgnoredRules'] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new Error('Unsupported or invalid preferences.');
  const rules = value.map((rule) => {
    if (!Number.isInteger(rule) || rule < 1 || rule > 10_000)
      throw new Error('Unsupported or invalid preferences.');
    return rule;
  });
  return [...new Set(rules)].sort((left, right) => left - right);
}

function validateChktexRuleSeverities(value: unknown): Preferences['chktexRuleSeverities'] {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Unsupported or invalid preferences.');
  const entries = Object.entries(value);
  if (entries.length > 100) throw new Error('Unsupported or invalid preferences.');
  const result: Preferences['chktexRuleSeverities'] = {};
  for (const [rule, severity] of entries) {
    const numericRule = Number(rule);
    if (
      !Number.isInteger(numericRule) ||
      numericRule < 1 ||
      numericRule > 10_000 ||
      (severity !== 'error' && severity !== 'warning' && severity !== 'info')
    )
      throw new Error('Unsupported or invalid preferences.');
    result[String(numericRule)] = severity;
  }
  return result;
}

function validateToolPaths(value: unknown): Preferences['toolPaths'] {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Unsupported or invalid preferences.');
  const result: Preferences['toolPaths'] = {};
  for (const [name, path] of Object.entries(value)) {
    if (!(CONFIGURABLE_TOOLS as readonly string[]).includes(name))
      throw new Error('Unsupported or invalid preferences.');
    result[name as ConfigurableTool] = validateToolPath(name as ConfigurableTool, path);
  }
  return result;
}

export function validatePreferences(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Preferences must be an object.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).some((key) => !preferenceKeys.includes(key)) ||
    !preferenceKeys
      .filter((key) => !optionalKeys.has(key))
      .every((key) => Object.hasOwn(candidate, key)) ||
    (Object.hasOwn(candidate, 'defaultRecipe') &&
      !BUILD_RECIPES.some((recipe) => recipe.value === candidate.defaultRecipe)) ||
    candidate.version !== 1 ||
    typeof candidate.theme !== 'string' ||
    (!themeNames.has(candidate.theme) &&
      !(
        Array.isArray(candidate.customThemes) &&
        candidate.customThemes.some(
          (t) =>
            typeof t === 'object' &&
            t !== null &&
            (t as Record<string, unknown>).id === candidate.theme,
        )
      )) ||
    typeof candidate.sidebarVisible !== 'boolean' ||
    (Object.hasOwn(candidate, 'previewVisible') && typeof candidate.previewVisible !== 'boolean') ||
    typeof candidate.outputVisible !== 'boolean' ||
    typeof candidate.editorWidth !== 'number' ||
    !Number.isFinite(candidate.editorWidth) ||
    candidate.editorWidth < 25 ||
    candidate.editorWidth > 75 ||
    (Object.hasOwn(candidate, 'fontSize') &&
      (typeof candidate.fontSize !== 'number' ||
        !Number.isInteger(candidate.fontSize) ||
        candidate.fontSize < FONT_SIZE_RANGE.min ||
        candidate.fontSize > FONT_SIZE_RANGE.max)) ||
    (Object.hasOwn(candidate, 'wrap') && typeof candidate.wrap !== 'boolean') ||
    (Object.hasOwn(candidate, 'autoSave') && typeof candidate.autoSave !== 'boolean') ||
    (Object.hasOwn(candidate, 'autoSaveDelayMs') &&
      (typeof candidate.autoSaveDelayMs !== 'number' ||
        !Number.isInteger(candidate.autoSaveDelayMs) ||
        candidate.autoSaveDelayMs < 1000 ||
        candidate.autoSaveDelayMs > 120_000)) ||
    (Object.hasOwn(candidate, 'editorMinimap') && typeof candidate.editorMinimap !== 'boolean') ||
    (Object.hasOwn(candidate, 'commonProblemHelp') &&
      typeof candidate.commonProblemHelp !== 'boolean') ||
    (Object.hasOwn(candidate, 'formatToolbarVisible') &&
      typeof candidate.formatToolbarVisible !== 'boolean') ||
    (Object.hasOwn(candidate, 'sidebarWidth') &&
      (typeof candidate.sidebarWidth !== 'number' ||
        !Number.isFinite(candidate.sidebarWidth) ||
        candidate.sidebarWidth < SIDEBAR_WIDTH_RANGE.min ||
        candidate.sidebarWidth > SIDEBAR_WIDTH_RANGE.max)) ||
    (Object.hasOwn(candidate, 'texlabEnabled') && typeof candidate.texlabEnabled !== 'boolean') ||
    (Object.hasOwn(candidate, 'chktexEnabled') && typeof candidate.chktexEnabled !== 'boolean') ||
    (Object.hasOwn(candidate, 'chktexRunMode') &&
      candidate.chktexRunMode !== 'save' &&
      candidate.chktexRunMode !== 'live') ||
    (Object.hasOwn(candidate, 'restoreSession') && typeof candidate.restoreSession !== 'boolean') ||
    (Object.hasOwn(candidate, 'tabCloseButtons') &&
      candidate.tabCloseButtons !== 'always' &&
      candidate.tabCloseButtons !== 'hover') ||
    (Object.hasOwn(candidate, 'previewTabs') && typeof candidate.previewTabs !== 'boolean') ||
    (Object.hasOwn(candidate, 'externalChangeDetection') &&
      typeof candidate.externalChangeDetection !== 'boolean') ||
    (Object.hasOwn(candidate, 'externalChangeQuietPeriodMs') &&
      (typeof candidate.externalChangeQuietPeriodMs !== 'number' ||
        !Number.isInteger(candidate.externalChangeQuietPeriodMs) ||
        candidate.externalChangeQuietPeriodMs < 2_000 ||
        candidate.externalChangeQuietPeriodMs > 5_000)) ||
    (Object.hasOwn(candidate, 'externalChangePollingOnly') &&
      typeof candidate.externalChangePollingOnly !== 'boolean') ||
    (Object.hasOwn(candidate, 'openDiffAfterConflictCopy') &&
      typeof candidate.openDiffAfterConflictCopy !== 'boolean') ||
    (Object.hasOwn(candidate, 'uiFont') && typeof candidate.uiFont !== 'string') ||
    (Object.hasOwn(candidate, 'editorFont') && typeof candidate.editorFont !== 'string') ||
    (Object.hasOwn(candidate, 'snippetsSymbolsOpenDefault') &&
      typeof candidate.snippetsSymbolsOpenDefault !== 'boolean') ||
    (Object.hasOwn(candidate, 'snippetsTemplatesOpenDefault') &&
      typeof candidate.snippetsTemplatesOpenDefault !== 'boolean') ||
    (Object.hasOwn(candidate, 'historyEnabled') && typeof candidate.historyEnabled !== 'boolean') ||
    (Object.hasOwn(candidate, 'historyIntervalMinutes') &&
      (typeof candidate.historyIntervalMinutes !== 'number' ||
        !Number.isInteger(candidate.historyIntervalMinutes) ||
        candidate.historyIntervalMinutes < 1 ||
        candidate.historyIntervalMinutes > 120))
  ) {
    throw new Error('Unsupported or invalid preferences.');
  }
  return {
    version: 1,
    theme: candidate.theme as Preferences['theme'],
    themeCustomizations: validateThemeCustomizations(candidate.themeCustomizations),
    sidebarVisible: candidate.sidebarVisible,
    previewVisible: (candidate.previewVisible ?? DEFAULT_PREFERENCES.previewVisible) as boolean,
    outputVisible: candidate.outputVisible,
    editorWidth: candidate.editorWidth,
    defaultRecipe: (candidate.defaultRecipe ??
      DEFAULT_PREFERENCES.defaultRecipe) as Preferences['defaultRecipe'],
    fontSize: (candidate.fontSize ?? DEFAULT_PREFERENCES.fontSize) as number,
    wrap: (candidate.wrap ?? DEFAULT_PREFERENCES.wrap) as boolean,
    autoSave: (candidate.autoSave ?? DEFAULT_PREFERENCES.autoSave) as boolean,
    autoSaveDelayMs: (candidate.autoSaveDelayMs ?? DEFAULT_PREFERENCES.autoSaveDelayMs) as number,
    editorMinimap: (candidate.editorMinimap ?? DEFAULT_PREFERENCES.editorMinimap) as boolean,
    commonProblemHelp: (candidate.commonProblemHelp ??
      DEFAULT_PREFERENCES.commonProblemHelp) as boolean,
    formatToolbarVisible: (candidate.formatToolbarVisible ??
      DEFAULT_PREFERENCES.formatToolbarVisible) as boolean,
    sidebarWidth: (candidate.sidebarWidth ?? DEFAULT_PREFERENCES.sidebarWidth) as number,
    texlabEnabled: (candidate.texlabEnabled ?? DEFAULT_PREFERENCES.texlabEnabled) as boolean,
    chktexEnabled: (candidate.chktexEnabled ?? DEFAULT_PREFERENCES.chktexEnabled) as boolean,
    chktexRunMode: (candidate.chktexRunMode ??
      DEFAULT_PREFERENCES.chktexRunMode) as Preferences['chktexRunMode'],
    chktexIgnoredRules: validateChktexIgnoredRules(candidate.chktexIgnoredRules),
    chktexRuleSeverities: validateChktexRuleSeverities(candidate.chktexRuleSeverities),
    toolPaths: validateToolPaths(candidate.toolPaths),
    restoreSession: (candidate.restoreSession ?? DEFAULT_PREFERENCES.restoreSession) as boolean,
    tabCloseButtons: (candidate.tabCloseButtons ??
      DEFAULT_PREFERENCES.tabCloseButtons) as Preferences['tabCloseButtons'],
    previewTabs: (candidate.previewTabs ?? DEFAULT_PREFERENCES.previewTabs) as boolean,
    externalChangeDetection: (candidate.externalChangeDetection ??
      DEFAULT_PREFERENCES.externalChangeDetection) as boolean,
    externalChangeQuietPeriodMs: (candidate.externalChangeQuietPeriodMs ??
      DEFAULT_PREFERENCES.externalChangeQuietPeriodMs) as number,
    externalChangePollingOnly: (candidate.externalChangePollingOnly ??
      DEFAULT_PREFERENCES.externalChangePollingOnly) as boolean,
    openDiffAfterConflictCopy: (candidate.openDiffAfterConflictCopy ??
      DEFAULT_PREFERENCES.openDiffAfterConflictCopy) as boolean,
    recentCommands: validateRecentCommands(candidate.recentCommands),
    uiFont: (candidate.uiFont ?? '') as string,
    editorFont: (candidate.editorFont ?? '') as string,
    customThemes: validateCustomThemes(candidate.customThemes),
    keyboardShortcuts: validateKeyboardShortcuts(candidate.keyboardShortcuts),
    snippetsSymbolsOpenDefault: (candidate.snippetsSymbolsOpenDefault ?? false) as boolean,
    snippetsTemplatesOpenDefault: (candidate.snippetsTemplatesOpenDefault ?? false) as boolean,
    historyEnabled: (candidate.historyEnabled ?? DEFAULT_PREFERENCES.historyEnabled) as boolean,
    historyIntervalMinutes: (candidate.historyIntervalMinutes ??
      DEFAULT_PREFERENCES.historyIntervalMinutes) as number,
  };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** User preferences only. Document contents and credentials never belong here. */
export class PreferencesStore {
  private readonly filename: string;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {
    this.filename = join(directory, 'preferences.json');
  }

  private async read(): Promise<Preferences> {
    try {
      return validatePreferences(JSON.parse(await readFile(this.filename, 'utf8')) as unknown);
    } catch (error) {
      if (isMissing(error)) return { ...DEFAULT_PREFERENCES };
      throw error;
    }
  }

  async get(): Promise<Preferences> {
    await this.pending.catch(() => undefined);
    return this.read();
  }

  async set(value: unknown): Promise<Preferences> {
    const preferences = validatePreferences(value);
    const write = this.pending
      .catch(() => undefined)
      .then(async () => {
        // Do not silently replace corrupt settings or an unknown future version.
        await this.read();
        await mkdir(this.directory, { recursive: true });
        const temporary = join(this.directory, `.preferences-${randomUUID()}.tmp`);
        try {
          const file = await open(temporary, 'wx', 0o600);
          try {
            await file.writeFile(`${JSON.stringify(preferences, null, 2)}\n`, 'utf8');
            await file.sync();
          } finally {
            await file.close();
          }
          await rename(temporary, this.filename);
        } finally {
          await unlink(temporary).catch((error: unknown) => {
            if (!isMissing(error)) throw error;
          });
        }
      });
    this.pending = write;
    await write;
    return { ...preferences };
  }
}
