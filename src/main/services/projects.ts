import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import type {
  CreateRequest,
  FileEntry,
  FileRef,
  FileRevision,
  FileSnapshot,
  ProjectInfo,
  RecentProject,
  RenameRequest,
  SaveRequest,
} from '../../shared/api';

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_PREVIEW_PDF_BYTES = 64 * 1024 * 1024;
const MAX_TREE_ENTRIES = 10000;
/** Listed in the tree but not walked, so they cannot exhaust the entry limit. */
const unexpandedNames = new Set(['.git', 'node_modules']);

export class ProjectError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectError';
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProjectError('INVALID_ARGUMENT', 'Invalid request.');
  return value as Record<string, unknown>;
}

export function validateRelativePath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 1024 ||
    isAbsolute(value) ||
    /[\\:<>"|?*]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new ProjectError(
      'INVALID_PATH',
      'Use a relative project path without special characters.',
    );
  }
  const parts = value.split('/');
  if (
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
        part.startsWith('.textra-save-'),
    )
  ) {
    throw new ProjectError('INVALID_PATH', 'This is not a valid project path.');
  }
  return value;
}

function revision(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

export class ProjectService {
  private active: { id: string; root: string } | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  private readonly recentFile: string;

  constructor(private readonly userData: string) {
    this.recentFile = join(userData, 'recent-projects.json');
  }

  async flush(): Promise<void> {
    await this.pending.catch(() => undefined);
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.catch(() => undefined).then(action);
    this.pending = result;
    return result;
  }

  getRoot(projectId: string): string {
    if (!this.active) throw new ProjectError('NO_PROJECT', 'Open a project folder first.');
    if (typeof projectId !== 'string' || projectId !== this.active.id)
      throw new ProjectError('STALE_PROJECT', 'The project changed. Refresh before trying again.');
    return this.active.root;
  }

  private validateRef(value: unknown): FileRef {
    const request = record(value);
    if (typeof request.projectId !== 'string')
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid project identifier.');
    this.getRoot(request.projectId);
    return { projectId: request.projectId, path: validateRelativePath(request.path) };
  }

  async resolvePath(value: FileRef, allowRoot = false, allowMissing = false): Promise<string> {
    const request = record(value);
    if (typeof request.projectId !== 'string')
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid project identifier.');
    const root = this.getRoot(request.projectId);
    const path = allowRoot && request.path === '' ? '' : validateRelativePath(request.path);
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (await realpath(root)) !== root)
      throw new ProjectError(
        'UNSAFE_PATH',
        'The project folder changed or contains an unsafe link.',
      );
    let target = root;
    const parts = path ? path.split('/') : [];
    for (let index = 0; index < parts.length; index++) {
      target = join(target, parts[index]);
      try {
        const info = await lstat(target);
        if (info.isSymbolicLink())
          throw new ProjectError('UNSAFE_PATH', 'Symbolic links and junctions are not supported.');
        if (index < parts.length - 1 && !info.isDirectory())
          throw new ProjectError('INVALID_PATH', 'The parent path is not a folder.');
        const canonical = await realpath(target);
        const within = relative(root, canonical);
        if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within))
          throw new ProjectError('UNSAFE_PATH', 'The path leaves the selected project.');
      } catch (error) {
        if (missing(error) && allowMissing && index === parts.length - 1) break;
        if (missing(error))
          throw new ProjectError('NOT_FOUND', 'The selected file or folder no longer exists.');
        throw error;
      }
    }
    this.getRoot(request.projectId);
    return target;
  }

  private async snapshot(ref: FileRef): Promise<FileSnapshot> {
    const target = await this.resolvePath(ref);
    const info = await lstat(target);
    if (!info.isFile()) throw new ProjectError('INVALID_PATH', 'Select a text file.');
    if (info.size > MAX_TEXT_BYTES)
      throw new ProjectError('FILE_TOO_LARGE', 'Text files must be smaller than 5 MiB.');
    const file = await open(target, 'r');
    let bytes: Buffer;
    try {
      const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const result = await file.read(buffer, size, buffer.length - size, null);
        if (result.bytesRead === 0) break;
        size += result.bytesRead;
      }
      if (size > MAX_TEXT_BYTES)
        throw new ProjectError('FILE_TOO_LARGE', 'Text files must be smaller than 5 MiB.');
      bytes = buffer.subarray(0, size);
    } finally {
      await file.close();
    }
    if (bytes.includes(0))
      throw new ProjectError('BINARY_FILE', 'This file is binary and cannot be edited as text.');
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new ProjectError('INVALID_ENCODING', 'Only UTF-8 text files can be edited.');
    }
    this.getRoot(ref.projectId);
    return { ...ref, content, revision: revision(bytes) };
  }

  async readFile(value: FileRef): Promise<FileSnapshot> {
    return this.snapshot(this.validateRef(value));
  }

  /** Reads a selected project PDF for the read-only Preview pane. */
  async readProjectPdf(value: FileRef): Promise<Uint8Array> {
    const ref = this.validateRef(value);
    if (!/\.pdf$/i.test(ref.path))
      throw new ProjectError('INVALID_PATH', 'Select a PDF file from this project.');
    const target = await this.resolvePath(ref);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink())
      throw new ProjectError('INVALID_PATH', 'Select a regular PDF file.');
    if (info.size > MAX_PREVIEW_PDF_BYTES)
      throw new ProjectError('FILE_TOO_LARGE', 'PDF previews must be smaller than 64 MiB.');
    const bytes = await readFile(target);
    if (bytes.subarray(0, 5).toString() !== '%PDF-')
      throw new ProjectError('INVALID_PDF', 'This file is not a valid PDF.');
    this.getRoot(ref.projectId);
    return new Uint8Array(bytes);
  }

  private encode(content: unknown): Buffer {
    if (typeof content !== 'string' || content.includes('\0'))
      throw new ProjectError('INVALID_ARGUMENT', 'File contents must be UTF-8 text.');
    const bytes = Buffer.from(content, 'utf8');
    if (bytes.length > MAX_TEXT_BYTES)
      throw new ProjectError('FILE_TOO_LARGE', 'Text files must be smaller than 5 MiB.');
    if (new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) !== content)
      throw new ProjectError(
        'INVALID_ENCODING',
        'File contents contain an invalid Unicode character.',
      );
    return bytes;
  }

  saveFile(value: SaveRequest): Promise<FileSnapshot> {
    return this.serialize(async () => {
      const ref = this.validateRef(value);
      const request = record(value);
      const bytes = this.encode(request.content);
      if (
        typeof request.expectedRevision !== 'string' ||
        !/^[a-f0-9]{64}$/.test(request.expectedRevision)
      )
        throw new ProjectError('INVALID_ARGUMENT', 'A valid file revision is required to save.');
      const current = await this.snapshot(ref);
      if (current.revision !== request.expectedRevision)
        throw new ProjectError(
          'CONFLICT',
          'The file changed on disk. Reload or compare it before saving. Your edits are still open.',
        );
      const target = await this.resolvePath(ref);
      const mode = (await lstat(target)).mode;
      const temporary = join(dirname(target), `.textra-save-${randomUUID()}.tmp`);
      try {
        const file = await open(temporary, 'wx', mode);
        try {
          await file.writeFile(bytes);
          await file.sync();
        } finally {
          await file.close();
        }
        // Recheck immediately before replacement, after preparing the complete file.
        if ((await this.snapshot(ref)).revision !== request.expectedRevision)
          throw new ProjectError(
            'CONFLICT',
            'The file changed while saving. Your edits are still open.',
          );
        await this.resolvePath(ref);
        await rename(temporary, target);
      } finally {
        await unlink(temporary).catch((error: unknown) => {
          if (!missing(error)) throw error;
        });
      }
      return { ...ref, content: request.content as string, revision: revision(bytes) };
    });
  }

  private async scan(projectId: string, initialTree = false): Promise<ProjectInfo> {
    const root = this.getRoot(projectId);
    const files: FileEntry[] = [];
    let truncated = false;
    const walk = async (path: string, depth: number): Promise<void> => {
      if (depth > 20 || files.length >= MAX_TREE_ENTRIES) {
        truncated = true;
        return;
      }
      const target = await this.resolvePath({ projectId, path }, true);
      const entries = await readdir(target, { withFileTypes: true });
      entries.sort(
        (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
      );
      for (const entry of entries) {
        if (files.length >= MAX_TREE_ENTRIES) {
          truncated = true;
          return;
        }
        const child = path ? `${path}/${entry.name}` : entry.name;
        try {
          validateRelativePath(child);
        } catch {
          continue;
        }
        if (
          entry.isSymbolicLink() ||
          (!entry.isFile() && !entry.isDirectory()) ||
          entry.name.startsWith('.textra-save-')
        )
          continue;
        files.push({
          path: child,
          name: entry.name,
          kind: entry.isDirectory() ? 'directory' : 'file',
        });
        if (
          !initialTree &&
          entry.isDirectory() &&
          !unexpandedNames.has(entry.name.toLowerCase()) &&
          child !== '.textra/history'
        )
          await walk(child, depth + 1);
      }
    };
    await walk('', 0);
    this.getRoot(projectId);
    const tex = files.filter((entry) => entry.kind === 'file' && /\.tex$/i.test(entry.path));
    let mainFile = tex.find((entry) => entry.path === 'main.tex')?.path ?? null;
    if (!mainFile && !initialTree) {
      const candidates = [...tex].sort(
        (a, b) => a.path.split('/').length - b.path.split('/').length,
      );
      for (const candidate of candidates.slice(0, 50)) {
        try {
          const target = await this.resolvePath({ projectId, path: candidate.path });
          const file = await open(target, 'r');
          let preview: string;
          try {
            const buffer = Buffer.alloc(64 * 1024);
            const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
            preview = buffer.subarray(0, bytesRead).toString('utf8');
          } finally {
            await file.close();
          }
          if (/^[ \t]*\\documentclass(?:\[|\{)/m.test(preview)) {
            mainFile = candidate.path;
            break;
          }
        } catch {
          /* Unreadable candidates remain visible for explicit user selection. */
        }
      }
    }
    mainFile ??= tex[0]?.path ?? null;
    return {
      id: projectId,
      name: basename(root),
      rootPath: root,
      files,
      mainFile,
      truncated,
      treeState: initialTree ? 'loading' : 'complete',
    };
  }

  async refreshProject(projectId: string): Promise<ProjectInfo> {
    return this.scan(projectId);
  }

  openRoot(root: string, options: { initialTree?: boolean } = {}): Promise<ProjectInfo> {
    return this.serialize(async () => {
      if (typeof root !== 'string' || !isAbsolute(root))
        throw new ProjectError('INVALID_PATH', 'Select an absolute project folder.');
      const info = await lstat(root);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new ProjectError(
          'UNSAFE_PATH',
          'Select a real folder, not a symbolic link or junction.',
        );
      const canonical = await realpath(root);
      const previous = this.active;
      this.active = { id: randomUUID(), root: canonical };
      try {
        const project = await this.scan(this.active.id, options.initialTree);
        const updateRecent = async () => {
          const recent = await this.loadRecent();
          const existing = recent.find((item) => item.rootPath === canonical);
          const item: RecentProject = {
            id: existing?.id ?? randomUUID(),
            name: basename(canonical),
            rootPath: canonical,
            pinned: existing?.pinned ?? false,
          };
          await this.writeRecent(
            [item, ...recent.filter((entry) => entry.rootPath !== canonical)].slice(0, 100),
          );
        };
        // Keep recents ordered and flushable, without gating known-file reads on fsync.
        if (options.initialTree) void this.serialize(updateRecent).catch(() => undefined);
        else await updateRecent();
        return project;
      } catch (error) {
        this.active = previous;
        throw error;
      }
    });
  }

  createEntry(value: CreateRequest): Promise<ProjectInfo> {
    return this.serialize(async () => {
      const ref = this.validateRef(value);
      const request = record(value);
      if (request.kind !== 'file' && request.kind !== 'directory')
        throw new ProjectError('INVALID_ARGUMENT', 'Choose a file or folder.');
      const bytes = this.encode(request.content ?? '');
      const target = await this.resolvePath(ref, false, true);
      if (request.kind === 'directory') await mkdir(target);
      else {
        const temporary = join(dirname(target), `.textra-save-${randomUUID()}.tmp`);
        try {
          const file = await open(temporary, 'wx', 0o600);
          try {
            await file.writeFile(bytes);
            await file.sync();
          } finally {
            await file.close();
          }
          await this.resolvePath(ref, false, true);
          // Publish the complete file atomically and fail if the destination exists.
          await link(temporary, target);
        } finally {
          await unlink(temporary).catch((error: unknown) => {
            if (!missing(error)) throw error;
          });
        }
      }
      return this.scan(ref.projectId);
    });
  }

  renameEntry(value: RenameRequest): Promise<ProjectInfo> {
    return this.serialize(async () => {
      const ref = this.validateRef(value);
      const newPath = validateRelativePath(record(value).newPath);
      const source = await this.resolvePath(ref);
      const destination = await this.resolvePath(
        { projectId: ref.projectId, path: newPath },
        false,
        true,
      );
      try {
        await lstat(destination);
        throw new ProjectError(
          'ALREADY_EXISTS',
          'The destination already exists. Choose a different name.',
        );
      } catch (error) {
        if (!missing(error)) throw error;
      }
      if (newPath.startsWith(`${ref.path}/`))
        throw new ProjectError('INVALID_PATH', 'A folder cannot be moved inside itself.');
      await rename(source, destination);
      return this.scan(ref.projectId);
    });
  }

  deleteEntry(value: FileRef, trash: (path: string) => Promise<void>): Promise<ProjectInfo> {
    return this.serialize(async () => {
      const ref = this.validateRef(value);
      const target = await this.resolvePath(ref);
      await trash(target);
      return this.scan(ref.projectId);
    });
  }

  async getFileRevisions(value: { projectId: string; paths: string[] }): Promise<FileRevision[]> {
    const request = record(value);
    if (
      typeof request.projectId !== 'string' ||
      !Array.isArray(request.paths) ||
      request.paths.length > 50
    )
      throw new ProjectError('INVALID_ARGUMENT', 'Poll up to 50 open files at a time.');
    const projectId = request.projectId;
    this.getRoot(projectId);
    const revisions: FileRevision[] = [];
    for (const path of request.paths as unknown[]) {
      const ref = this.validateRef({ projectId, path });
      try {
        revisions.push({ path: ref.path, revision: (await this.snapshot(ref)).revision });
      } catch (error) {
        if (error instanceof ProjectError && error.code === 'NOT_FOUND')
          revisions.push({ path: ref.path, revision: null });
        else throw error;
      }
    }
    return revisions;
  }

  private async loadRecent(): Promise<RecentProject[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.recentFile, 'utf8'));
      const data = record(parsed);
      if (data.version !== 1 || !Array.isArray(data.projects) || data.projects.length > 100)
        throw new ProjectError(
          'INVALID_SETTINGS',
          'Recent project settings are invalid and were preserved.',
        );
      return data.projects.map((value: unknown) => {
        const item = record(value);
        if (
          typeof item.id !== 'string' ||
          typeof item.name !== 'string' ||
          typeof item.rootPath !== 'string' ||
          !isAbsolute(item.rootPath) ||
          typeof item.pinned !== 'boolean'
        )
          throw new ProjectError(
            'INVALID_SETTINGS',
            'Recent project settings are invalid and were preserved.',
          );
        return { id: item.id, name: item.name, rootPath: item.rootPath, pinned: item.pinned };
      });
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
  }

  private async writeRecent(projects: RecentProject[]): Promise<void> {
    await mkdir(this.userData, { recursive: true });
    const temporary = join(this.userData, `.recent-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.recentFile);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!missing(error)) throw error;
      });
    }
  }

  async getRecentProjects(): Promise<RecentProject[]> {
    await this.pending.catch(() => undefined);
    return this.loadRecent();
  }

  async openRecentProject(
    id: string,
    options: { initialTree?: boolean } = {},
  ): Promise<ProjectInfo> {
    if (typeof id !== 'string')
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid recent project.');
    const entry = (await this.getRecentProjects()).find((item) => item.id === id);
    if (!entry) throw new ProjectError('NOT_FOUND', 'This recent project is no longer available.');
    return this.openRoot(entry.rootPath, options);
  }

  setProjectPinned(value: { id: string; pinned: boolean }): Promise<RecentProject[]> {
    return this.serialize(async () => {
      const request = record(value);
      if (typeof request.id !== 'string' || typeof request.pinned !== 'boolean')
        throw new ProjectError('INVALID_ARGUMENT', 'Invalid recent project preference.');
      const recent = await this.loadRecent();
      const entry = recent.find((item) => item.id === request.id);
      if (!entry)
        throw new ProjectError('NOT_FOUND', 'This recent project is no longer available.');
      entry.pinned = request.pinned;
      await this.writeRecent(recent);
      return recent;
    });
  }
}
