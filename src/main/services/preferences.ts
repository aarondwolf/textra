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
  'previewVisible',
  'fontSize',
  'wrap',
  'sidebarWidth',
  'texlabEnabled',
  'toolPaths',
]);

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
    (candidate.theme !== 'dark' && candidate.theme !== 'light') ||
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
    (Object.hasOwn(candidate, 'sidebarWidth') &&
      (typeof candidate.sidebarWidth !== 'number' ||
        !Number.isFinite(candidate.sidebarWidth) ||
        candidate.sidebarWidth < SIDEBAR_WIDTH_RANGE.min ||
        candidate.sidebarWidth > SIDEBAR_WIDTH_RANGE.max)) ||
    (Object.hasOwn(candidate, 'texlabEnabled') && typeof candidate.texlabEnabled !== 'boolean')
  ) {
    throw new Error('Unsupported or invalid preferences.');
  }
  return {
    version: 1,
    theme: candidate.theme,
    sidebarVisible: candidate.sidebarVisible,
    previewVisible: (candidate.previewVisible ?? DEFAULT_PREFERENCES.previewVisible) as boolean,
    outputVisible: candidate.outputVisible,
    editorWidth: candidate.editorWidth,
    defaultRecipe: (candidate.defaultRecipe ??
      DEFAULT_PREFERENCES.defaultRecipe) as Preferences['defaultRecipe'],
    fontSize: (candidate.fontSize ?? DEFAULT_PREFERENCES.fontSize) as number,
    wrap: (candidate.wrap ?? DEFAULT_PREFERENCES.wrap) as boolean,
    sidebarWidth: (candidate.sidebarWidth ?? DEFAULT_PREFERENCES.sidebarWidth) as number,
    texlabEnabled: (candidate.texlabEnabled ?? DEFAULT_PREFERENCES.texlabEnabled) as boolean,
    toolPaths: validateToolPaths(candidate.toolPaths),
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
