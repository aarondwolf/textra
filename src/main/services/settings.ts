import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { BuildEngine, Preferences, ProjectConfig } from '../../shared/api';
import { parse, type ParseError } from 'jsonc-parser';
import { createDefaultRecipeSettings, validateRecipeSettings } from '../../shared/recipes';
import { validatePreferences } from './preferences';
import { ProjectError, validateRelativePath } from './projects';

const MAX_SETTINGS_BYTES = 1024 * 1024;
const engines = new Set<BuildEngine>([
  'pdflatex',
  'xelatex',
  'lualatex',
  'latexmk',
  'bibtex-pipeline',
]);

export type { ProjectConfig } from '../../shared/api';

export class SettingsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SettingsError';
  }
}

export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  schemaVersion: 1,
  rootFile: null,
  engine: 'pdflatex',
  ...createDefaultRecipeSettings(),
};

function invalid(): never {
  throw new SettingsError(
    'INVALID_SETTINGS',
    'Settings are invalid or use an unsupported schema. Existing settings were preserved.',
  );
}

function exactRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(candidate, key))
  )
    return invalid();
  return candidate;
}

function parseText(value: unknown): unknown {
  if (
    typeof value !== 'string' ||
    value.length > MAX_SETTINGS_BYTES ||
    Buffer.byteLength(value, 'utf8') > MAX_SETTINGS_BYTES
  )
    return invalid();
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return invalid();
  }
}

/** Only explicitly supported UI preferences are portable; credentials are never accepted. */
export function exportSettings(preferences: unknown): string {
  let validated: Preferences;
  try {
    validated = validatePreferences(preferences);
  } catch {
    return invalid();
  }
  return `${JSON.stringify({ schemaVersion: 1, preferences: validated }, null, 2)}\n`;
}

export function importSettings(text: unknown): Preferences {
  const bundle = exactRecord(parseText(text), ['schemaVersion', 'preferences']);
  if (bundle.schemaVersion !== 1) return invalid();
  try {
    return validatePreferences(bundle.preferences);
  } catch {
    return invalid();
  }
}

export function validateProjectConfig(value: unknown): ProjectConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const candidate = value as Record<string, unknown>;
  const allowed = new Set([
    'schemaVersion',
    'rootFile',
    'engine',
    'recipes',
    ...Object.keys(createDefaultRecipeSettings()),
  ]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) return invalid();
  const engine = candidate.engine === undefined ? 'pdflatex' : candidate.engine;
  if (
    (candidate.schemaVersion !== undefined && candidate.schemaVersion !== 1) ||
    typeof engine !== 'string' ||
    !engines.has(engine as BuildEngine)
  )
    return invalid();
  const rootFile =
    candidate.rootFile === undefined || candidate.rootFile === null
      ? null
      : validateRelativePath(candidate.rootFile);
  if (
    rootFile !== null &&
    (!/\.tex$/i.test(rootFile) ||
      rootFile.split('/').some((part) => ['.textra', '.git', 'node_modules'].includes(part)))
  )
    return invalid();
  let recipeSettings: ReturnType<typeof validateRecipeSettings>;
  try {
    recipeSettings = validateRecipeSettings(candidate);
  } catch (error) {
    if (!(error instanceof Error)) return invalid();
    throw new SettingsError(
      'INVALID_SETTINGS',
      `${error.message} Existing settings were preserved.`,
    );
  }
  let recipes: Record<string, string> | undefined;
  if (Object.hasOwn(candidate, 'recipes')) {
    if (
      !candidate.recipes ||
      typeof candidate.recipes !== 'object' ||
      Array.isArray(candidate.recipes)
    )
      return invalid();
    const entries = Object.entries(candidate.recipes);
    if (entries.length > 10000) return invalid();
    recipes = Object.fromEntries(
      entries.map(([path, recipe]) => {
        validateRelativePath(path);
        if (
          !/\.tex$/i.test(path) ||
          typeof recipe !== 'string' ||
          (!engines.has(recipe as BuildEngine) &&
            !recipeSettings['latex-workshop.latex.recipes'].some((item) => item.name === recipe))
        )
          return invalid();
        return [path, recipe];
      }),
    );
  }
  return {
    schemaVersion: 1,
    rootFile,
    engine: engine as BuildEngine,
    ...recipeSettings,
    ...(recipes ? { recipes } : {}),
  };
}

function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

/** Owns canonical project settings separately from portable application preferences. */
export class ConfigService {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(
    _userData: string,
    private readonly getRoot: (projectId: string) => string,
  ) {}

  async flush(): Promise<void> {
    await this.pending.catch(() => undefined);
  }

  private root(projectId: string): string {
    if (typeof projectId !== 'string' || !projectId)
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid project identifier.');
    return this.getRoot(projectId);
  }

  private async paths(
    projectId: string,
    basename = 'settings.json',
  ): Promise<{
    directory: string;
    filename: string;
    directoryExists: boolean;
    fileExists: boolean;
  }> {
    const root = this.root(projectId);
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (await realpath(root)) !== root)
      throw new ProjectError(
        'UNSAFE_PATH',
        'The project folder changed or contains an unsafe link.',
      );
    const directory = join(root, '.textra');
    const filename = join(directory, basename);
    let directoryExists = false;
    let fileExists = false;
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory)
        throw new ProjectError('UNSAFE_PATH', 'The project settings folder must be a real folder.');
      directoryExists = true;
      try {
        const fileInfo = await lstat(filename);
        if (
          !fileInfo.isFile() ||
          fileInfo.isSymbolicLink() ||
          (await realpath(filename)) !== filename
        )
          throw new ProjectError(
            'UNSAFE_PATH',
            'The project settings file must be a regular file.',
          );
        fileExists = true;
      } catch (error) {
        if (!missing(error)) throw error;
      }
    } catch (error) {
      if (!missing(error)) throw error;
    }
    if (this.root(projectId) !== root)
      throw new ProjectError('STALE_PROJECT', 'The project changed while reading settings.');
    return { directory, filename, directoryExists, fileExists };
  }

  private async read(
    projectId: string,
  ): Promise<{ config: ProjectConfig; text: string | null; filename: string | null }> {
    let paths = await this.paths(projectId);
    if (!paths.fileExists) paths = await this.paths(projectId, 'project.json');
    if (!paths.fileExists) return { config: validateProjectConfig({}), text: null, filename: null };
    const file = await open(paths.filename, 'r');
    let text: string;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_SETTINGS_BYTES) return invalid();
      const bytes = Buffer.alloc(info.size + 1);
      let size = 0;
      while (size < bytes.length) {
        const chunk = await file.read(bytes, size, bytes.length - size, null);
        if (!chunk.bytesRead) break;
        size += chunk.bytesRead;
      }
      if (size > MAX_SETTINGS_BYTES) return invalid();
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
      } catch {
        return invalid();
      }
    } finally {
      await file.close();
    }
    await this.paths(projectId);
    const errors: ParseError[] = [];
    const value: unknown = parse(text, errors, {
      allowTrailingComma: true,
      disallowComments: false,
    });
    if (errors.length) return invalid();
    return { config: validateProjectConfig(value), text, filename: paths.filename };
  }

  async getProjectConfig(projectId: string): Promise<ProjectConfig> {
    await this.pending.catch(() => undefined);
    return (await this.read(projectId)).config;
  }

  ensureProjectConfig(projectId: string): Promise<ProjectConfig> {
    const write = this.pending
      .catch(() => undefined)
      .then(async () => {
        const before = await this.read(projectId);
        if ((await this.paths(projectId)).fileExists) return (await this.read(projectId)).config;
        return this.write(projectId, before.config, before);
      });
    this.pending = write;
    return write;
  }

  setProjectConfig(value: {
    projectId: string;
    config: ProjectConfig;
    expectedConfig?: ProjectConfig;
  }): Promise<ProjectConfig> {
    const write = this.pending
      .catch(() => undefined)
      .then(async () => {
        const hasExpected =
          !!value && typeof value === 'object' && Object.hasOwn(value, 'expectedConfig');
        const request = exactRecord(value, [
          'projectId',
          'config',
          ...(hasExpected ? ['expectedConfig'] : []),
        ]);
        if (typeof request.projectId !== 'string')
          throw new ProjectError('INVALID_ARGUMENT', 'Invalid project identifier.');
        const projectId = request.projectId;
        const config = validateProjectConfig(request.config);
        const before = await this.read(projectId);
        if (
          hasExpected &&
          !sameConfig(validateProjectConfig(request.expectedConfig), before.config)
        )
          conflict();
        return this.write(projectId, config, before);
      });
    this.pending = write;
    return write;
  }

  private async write(
    projectId: string,
    config: ProjectConfig,
    before: { text: string | null; filename: string | null },
  ): Promise<ProjectConfig> {
    const serialized = `${JSON.stringify(config, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SETTINGS_BYTES) return invalid();
    let paths = await this.paths(projectId);
    const existed = paths.fileExists;
    if (!paths.directoryExists) {
      try {
        await mkdir(paths.directory);
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST')
          throw error;
      }
      paths = await this.paths(projectId);
    }
    const temporary = join(paths.directory, `.settings-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(serialized, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await retryTransient(async () => {
        // Revalidate every retry: a lock must never turn into permission to overwrite new edits.
        const current = await this.read(projectId);
        if (current.text !== before.text || current.filename !== before.filename) conflict();
        await this.paths(projectId);
        if (existed) await rename(temporary, paths.filename);
        else {
          try {
            await link(temporary, paths.filename);
          } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
              conflict();
            throw error;
          }
        }
      });
    } finally {
      await retryTransient(() => unlink(temporary)).catch((error: unknown) => {
        if (!missing(error)) throw error;
      });
    }
    return config;
  }
}

async function retryTransient<T>(action: () => Promise<T>): Promise<T> {
  const delays = [50, 100, 200, 400, 800];
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (
        attempt >= delays.length ||
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        !['EPERM', 'EBUSY', 'EACCES'].includes(String(error.code))
      )
        throw error;
      await delay(delays[attempt]);
    }
  }
}

function conflict(): never {
  throw new ProjectError('CONFLICT', 'Project settings changed on disk. Reload before saving.');
}

function sameConfig(left: ProjectConfig, right: ProjectConfig): boolean {
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, normalize(child)]),
          )
        : value;
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
