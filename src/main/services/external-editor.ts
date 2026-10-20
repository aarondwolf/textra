import { spawn } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, join, posix } from 'node:path';
import type {
  CreateConflictCopyRequest,
  ExternalFileChangeEvent,
  ExternalWatchRequest,
  ExternalWatchState,
  FileRef,
  FileSnapshot,
} from '../../shared/api';
import { ProjectError } from './projects';

const POLL_INTERVAL_MS = 750;
const NOTIFICATION_DEBOUNCE_MS = 175;
const DEFAULT_QUIET_PERIOD_MS = 3000;
const MIN_QUIET_PERIOD_MS = 2000;
const MAX_QUIET_PERIOD_MS = 5000;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

interface ProjectFiles {
  readFile(ref: FileRef): Promise<FileSnapshot>;
  resolvePath(ref: FileRef, allowRoot?: boolean, allowMissing?: boolean): Promise<string>;
}

interface Signature {
  revision: string;
  size: number;
  mtimeMs: number;
}

interface WatchedFile {
  ref: FileRef;
  absolutePath: string;
  watcher: FSWatcher | null;
  poller: ReturnType<typeof setInterval>;
  debounce: ReturnType<typeof setTimeout> | null;
  quietTimer: ReturnType<typeof setTimeout> | null;
  quietPeriodMs: number;
  signature: Signature | null;
  state: ExternalWatchState['state'];
  lastExternalChangeAt: number | null;
}

function key(ref: FileRef): string {
  return `${ref.projectId}\u0000${ref.path}`;
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isProjectMissing(error: unknown): boolean {
  return error instanceof ProjectError && error.code === 'NOT_FOUND';
}

function timestamp(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function conflictPath(path: string, stamp: string, index: number): string {
  const extension = extname(path);
  const name = basename(path, extension);
  const suffix = index === 0 ? '' : `_${index + 1}`;
  const filename = `${name}.CONFLICTED_${stamp}${suffix}${extension}`;
  const parent = posix.dirname(path);
  return parent === '.' ? filename : `${parent}/${filename}`;
}

/**
 * Watches only renderer-open project files. It deliberately has no write path to
 * the original document: conflict snapshots are create-only sibling files.
 */
export class ExternalEditorService {
  private readonly watched = new Map<string, WatchedFile>();
  private readonly listeners = new Set<(event: ExternalFileChangeEvent) => void>();

  constructor(private readonly projects: ProjectFiles) {}

  onChange(listener: (event: ExternalFileChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(entry: WatchedFile): void {
    const event: ExternalFileChangeEvent = {
      ...entry.ref,
      state: entry.state,
      revision: entry.signature?.revision ?? null,
      observedAt: Date.now(),
    };
    for (const listener of this.listeners) listener(event);
  }

  private async signature(ref: FileRef): Promise<Signature | null> {
    try {
      const [snapshot, info] = await Promise.all([
        this.projects.readFile(ref),
        this.projects.resolvePath(ref).then((path) => stat(path)),
      ]);
      return { revision: snapshot.revision, size: info.size, mtimeMs: info.mtimeMs };
    } catch (error) {
      if (isProjectMissing(error) || missing(error)) return null;
      throw error;
    }
  }

  private scheduleQuietCheck(entry: WatchedFile): void {
    if (entry.quietTimer) return;
    entry.quietTimer = setTimeout(() => {
      entry.quietTimer = null;
      void this.sample(entry, false);
    }, entry.quietPeriodMs);
  }

  private async sample(entry: WatchedFile, fromRenameEvent: boolean): Promise<void> {
    if (this.watched.get(key(entry.ref)) !== entry) return;
    const next = await this.signature(entry.ref);
    if (!next) {
      const nextState: ExternalWatchState['state'] = fromRenameEvent ? 'renamed' : 'deleted';
      if (entry.state !== nextState || entry.signature !== null) {
        entry.signature = null;
        entry.state = nextState;
        entry.lastExternalChangeAt = Date.now();
        this.emit(entry);
      }
      return;
    }
    const changed =
      !entry.signature ||
      next.revision !== entry.signature.revision ||
      next.size !== entry.signature.size ||
      next.mtimeMs !== entry.signature.mtimeMs;
    if (changed) {
      if (entry.quietTimer) {
        clearTimeout(entry.quietTimer);
        entry.quietTimer = null;
      }
      entry.signature = next;
      entry.state = 'changing';
      entry.lastExternalChangeAt = Date.now();
      this.emit(entry);
      this.scheduleQuietCheck(entry);
      return;
    }
    if (entry.state === 'changing' && entry.lastExternalChangeAt !== null) {
      if (Date.now() - entry.lastExternalChangeAt >= entry.quietPeriodMs) {
        entry.state = 'stable';
        this.emit(entry);
      } else this.scheduleQuietCheck(entry);
    }
  }

  private scheduleSample(entry: WatchedFile, fromRenameEvent: boolean): void {
    if (entry.debounce) clearTimeout(entry.debounce);
    entry.debounce = setTimeout(() => {
      entry.debounce = null;
      void this.sample(entry, fromRenameEvent).catch(() => undefined);
    }, NOTIFICATION_DEBOUNCE_MS);
  }

  async watch(value: ExternalWatchRequest): Promise<ExternalWatchState> {
    if (!value || typeof value !== 'object' || typeof value.projectId !== 'string')
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid external file watch request.');
    if (typeof value.path !== 'string')
      throw new ProjectError('INVALID_ARGUMENT', 'Choose a project file to watch.');
    if (
      value.quietPeriodMs !== undefined &&
      (!Number.isInteger(value.quietPeriodMs) ||
        value.quietPeriodMs < MIN_QUIET_PERIOD_MS ||
        value.quietPeriodMs > MAX_QUIET_PERIOD_MS)
    )
      throw new ProjectError('INVALID_ARGUMENT', 'Choose a quiet period between 2 and 5 seconds.');
    this.unwatch(value);
    const ref: FileRef = { projectId: value.projectId, path: value.path };
    const absolutePath = await this.projects.resolvePath(ref);
    const signature = await this.signature(ref);
    const entry: WatchedFile = {
      ref,
      absolutePath,
      watcher: null,
      poller: setInterval(
        () => void this.sample(entry, false).catch(() => undefined),
        POLL_INTERVAL_MS,
      ),
      debounce: null,
      quietTimer: null,
      quietPeriodMs: value.quietPeriodMs ?? DEFAULT_QUIET_PERIOD_MS,
      signature,
      state: 'watching',
      lastExternalChangeAt: null,
    };
    if (!value.pollingOnly) {
      try {
        entry.watcher = watch(dirname(absolutePath), { persistent: false }, (event, filename) => {
          if (filename && String(filename) !== basename(absolutePath)) return;
          this.scheduleSample(entry, event === 'rename');
        });
        entry.watcher.on('error', () => {
          entry.watcher?.close();
          entry.watcher = null;
        });
      } catch {
        // Polling is always active and is the compatibility fallback.
      }
    }
    this.watched.set(key(ref), entry);
    return {
      ...ref,
      state: 'watching',
      revision: signature?.revision ?? null,
      observedAt: Date.now(),
    };
  }

  unwatch(ref: FileRef): void {
    const entry = this.watched.get(key(ref));
    if (!entry) return;
    this.watched.delete(key(ref));
    entry.watcher?.close();
    clearInterval(entry.poller);
    if (entry.debounce) clearTimeout(entry.debounce);
    if (entry.quietTimer) clearTimeout(entry.quietTimer);
  }

  clear(): void {
    for (const entry of [...this.watched.values()]) this.unwatch(entry.ref);
  }

  /** Prevent TeXtra's own successful atomic save from being reported as external. */
  async noteLocalSave(snapshot: FileSnapshot): Promise<void> {
    const entry = this.watched.get(key(snapshot));
    if (!entry) return;
    entry.signature = await this.signature(snapshot);
    entry.state = 'watching';
    entry.lastExternalChangeAt = null;
    if (entry.quietTimer) clearTimeout(entry.quietTimer);
  }

  async createConflictCopy(request: CreateConflictCopyRequest): Promise<FileSnapshot> {
    if (!request || typeof request !== 'object' || typeof request.content !== 'string')
      throw new ProjectError('INVALID_ARGUMENT', 'The editor buffer must be text.');
    if (request.content.includes('\0'))
      throw new ProjectError('INVALID_ARGUMENT', 'The editor buffer must be UTF-8 text.');
    const bytes = Buffer.from(request.content, 'utf8');
    if (bytes.length > MAX_TEXT_BYTES)
      throw new ProjectError('FILE_TOO_LARGE', 'Text files must be smaller than 5 MiB.');
    if (new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== request.content)
      throw new ProjectError('INVALID_ENCODING', 'The editor buffer has invalid Unicode.');
    const source: FileRef = { projectId: request.projectId, path: request.path };
    // Validate the original path and its parent even if an external editor renamed or deleted it.
    await this.projects.resolvePath(source, false, true);
    const stamp = timestamp();
    for (let index = 0; index < 1000; index++) {
      const path = conflictPath(source.path, stamp, index);
      const target = await this.projects.resolvePath(
        { projectId: source.projectId, path },
        false,
        true,
      );
      try {
        const file = await open(target, 'wx', 0o600);
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        return {
          projectId: source.projectId,
          path,
          content: request.content,
          revision: createHash('sha256').update(bytes).digest('hex'),
        };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')
          continue;
        throw error;
      }
    }
    throw new ProjectError(
      'CONFLICT_COPY_FAILED',
      'Too many conflict snapshots already exist. Use Save As.',
    );
  }
}

export async function findCodeExecutable(): Promise<string | null> {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA)
      candidates.push(join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe'));
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (base) candidates.push(join(base, 'Microsoft VS Code/Code.exe'));
    }
  } else if (process.platform === 'darwin')
    candidates.push('/Applications/Visual Studio Code.app/Contents/MacOS/Electron');
  else candidates.push('/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code');
  for (const path of candidates) {
    try {
      if ((await stat(path)).isFile()) return path;
    } catch {
      /* Optional application. */
    }
  }
  return null;
}

export async function openInExternalEditor(target: string): Promise<void> {
  const executable = await findCodeExecutable();
  if (!executable)
    throw new ProjectError(
      'TOOL_NOT_FOUND',
      'Visual Studio Code was not found in a standard installation location.',
    );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['--reuse-window', target], {
      shell: false,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', () =>
      reject(new ProjectError('TOOL_FAILED', 'Visual Studio Code could not be started.')),
    );
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
