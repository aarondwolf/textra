import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuildEngine, Preferences, ProjectConfig } from '../../shared/api';
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
  const hasRecipes = !!value && typeof value === 'object' && Object.hasOwn(value, 'recipes');
  const candidate = exactRecord(value, [
    'schemaVersion',
    'rootFile',
    'engine',
    ...(hasRecipes ? ['recipes'] : []),
  ]);
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.engine !== 'string' ||
    !engines.has(candidate.engine as BuildEngine)
  )
    return invalid();
  const rootFile = candidate.rootFile === null ? null : validateRelativePath(candidate.rootFile);
  if (rootFile !== null && !/\.tex$/i.test(rootFile)) return invalid();
  let recipes: Record<string, BuildEngine> | undefined;
  if (hasRecipes) {
    if (
      !candidate.recipes ||
      typeof candidate.recipes !== 'object' ||
      Array.isArray(candidate.recipes)
    )
      return invalid();
    const entries = Object.entries(candidate.recipes);
    if (entries.length > 10000) return invalid();
    recipes = Object.fromEntries(
      entries.map(([path, engine]) => {
        validateRelativePath(path);
        if (
          !/\.tex$/i.test(path) ||
          typeof engine !== 'string' ||
          !engines.has(engine as BuildEngine)
        )
          return invalid();
        return [path, engine as BuildEngine];
      }),
    );
  }
  return {
    schemaVersion: 1,
    rootFile,
    engine: candidate.engine as BuildEngine,
    ...(recipes ? { recipes } : {}),
  };
}

function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

/** Owns only optional project overrides, separate from the portable preferences bundle. */
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

  private async paths(projectId: string): Promise<{
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
    const filename = join(directory, 'project.json');
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

  private async read(projectId: string): Promise<{ config: ProjectConfig; text: string | null }> {
    const paths = await this.paths(projectId);
    if (!paths.fileExists) return { config: { ...DEFAULT_PROJECT_CONFIG }, text: null };
    const file = await open(paths.filename, 'r');
    let text: string;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_SETTINGS_BYTES) return invalid();
      const bytes = Buffer.alloc(MAX_SETTINGS_BYTES + 1);
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
    return { config: validateProjectConfig(parseText(text)), text };
  }

  async getProjectConfig(projectId: string): Promise<ProjectConfig> {
    await this.pending.catch(() => undefined);
    return (await this.read(projectId)).config;
  }

  setProjectConfig(value: { projectId: string; config: ProjectConfig }): Promise<ProjectConfig> {
    const write = this.pending
      .catch(() => undefined)
      .then(async () => {
        const request = exactRecord(value, ['projectId', 'config']);
        if (typeof request.projectId !== 'string')
          throw new ProjectError('INVALID_ARGUMENT', 'Invalid project identifier.');
        const projectId = request.projectId;
        const config = validateProjectConfig(request.config);
        const before = await this.read(projectId);
        let paths = await this.paths(projectId);
        if (!paths.directoryExists) {
          await mkdir(paths.directory);
          paths = await this.paths(projectId);
        }
        const temporary = join(paths.directory, `.project-${randomUUID()}.tmp`);
        try {
          const file = await open(temporary, 'wx', 0o600);
          try {
            await file.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
            await file.sync();
          } finally {
            await file.close();
          }
          // Preparing the complete replacement must not overwrite an intervening edit.
          if ((await this.read(projectId)).text !== before.text)
            throw new ProjectError(
              'CONFLICT',
              'Project settings changed on disk. Reload before saving.',
            );
          await this.paths(projectId);
          await rename(temporary, paths.filename);
        } finally {
          await unlink(temporary).catch((error: unknown) => {
            if (!missing(error)) throw error;
          });
        }
        return config;
      });
    this.pending = write;
    return write;
  }
}
