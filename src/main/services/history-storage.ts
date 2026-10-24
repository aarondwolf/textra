import { retryTransient } from './retry';
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, opendir, realpath, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { readBounded } from './bounded-read';
import { ProjectError, validateRelativePath } from './projects';

export function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

function unsafe(): never {
  throw new ProjectError(
    'UNSAFE_PATH',
    'History storage must use regular files inside real folders.',
  );
}



/** All history paths, including persisted paths, pass this authority before filesystem access. */
export class HistoryStorage {
  constructor(readonly root: string) {}

  async resolve(
    parts: string[],
    kind: 'file' | 'directory',
    createParents = false,
    missingLeaf = false,
  ): Promise<string | null> {
    for (const part of parts) {
      validateRelativePath(part);
      if (part.includes('/')) unsafe();
    }
    const rootInfo = await lstat(this.root);
    if (
      !rootInfo.isDirectory() ||
      rootInfo.isSymbolicLink() ||
      (await realpath(this.root)) !== this.root
    )
      unsafe();
    let target = this.root;
    for (let index = 0; index < parts.length; index++) {
      target = join(target, parts[index]);
      const directory = index < parts.length - 1 || kind === 'directory';
      let info;
      try {
        info = await lstat(target);
      } catch (error) {
        if (!isMissing(error)) throw error;
        if (directory && createParents) {
          try {
            await mkdir(target);
          } catch (creationError) {
            if (
              !creationError ||
              typeof creationError !== 'object' ||
              !('code' in creationError) ||
              creationError.code !== 'EEXIST'
            )
              throw creationError;
          }
          info = await lstat(target);
        } else return !directory && missingLeaf ? target : null;
      }
      if (
        info.isSymbolicLink() ||
        (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
      )
        unsafe();
      const canonical = await realpath(target);
      const within = relative(this.root, canonical);
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) unsafe();
    }
    return target;
  }

  async read(parts: string[], maximum: number): Promise<Buffer | null> {
    const target = await this.resolve(parts, 'file');
    if (!target) return null;
    const before = await lstat(target);
    const file = await open(target, 'r');
    try {
      const opened = await file.stat();
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino
      )
        unsafe();
      const tooLarge = (): never => {
        throw new ProjectError(
          'HISTORY_LIMIT',
          'History storage exceeds its supported size limit.',
        );
      };
      if (opened.size > maximum) tooLarge();
      const bytes = await readBounded(file, maximum, tooLarge);
      await this.resolve(parts, 'file');
      const after = await lstat(target);
      if (after.dev !== opened.dev || after.ino !== opened.ino) unsafe();
      return bytes;
    } finally {
      await file.close();
    }
  }

  /** Replace only the exact index which was read, or exclusively publish a new file. */
  async write(
    parts: string[],
    bytes: Buffer,
    expected: Buffer | null,
    maximum: number,
  ): Promise<void> {
    if (bytes.length > maximum)
      throw new ProjectError('HISTORY_LIMIT', 'History storage exceeds its supported size limit.');
    const target = await this.resolve(parts, 'file', true, true);
    if (!target) unsafe();
    const temporaryParts = [...parts.slice(0, -1), `.history-${randomUUID()}.tmp`];
    const temporary = await this.resolve(temporaryParts, 'file', false, true);
    if (!temporary) unsafe();
    let temporaryIdentity: { dev: number; ino: number } | null = null;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        const info = await file.stat();
        temporaryIdentity = { dev: info.dev, ino: info.ino };
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      await retryTransient(async () => {
        // A sharing lock must never grant permission to replace newer contents.
        const current = await this.read(parts, maximum);
        if (expected === null ? current !== null : current === null || !current.equals(expected))
          throw new ProjectError(
            'CONFLICT',
            'File history changed on disk. Refresh before trying again.',
          );
        await this.resolve(parts, 'file', false, true);
        await this.resolve(temporaryParts, 'file');
        const prepared = await lstat(temporary);
        if (
          !temporaryIdentity ||
          prepared.dev !== temporaryIdentity.dev ||
          prepared.ino !== temporaryIdentity.ino
        )
          unsafe();
        if (expected === null) await link(temporary, target);
        else await rename(temporary, target);
      });
    } finally {
      // Exclusive publication briefly leaves our temporary with two hard links.
      // Validate its parent, then remove only our unpredictable temporary name.
      await retryTransient(async () => {
        await this.resolve(temporaryParts.slice(0, -1), 'directory');
        try {
          const info = await lstat(temporary);
          if (
            info.isSymbolicLink() ||
            !info.isFile() ||
            info.nlink > 2 ||
            !temporaryIdentity ||
            info.dev !== temporaryIdentity.dev ||
            info.ino !== temporaryIdentity.ino
          )
            unsafe();
          await unlink(temporary);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      });
    }
  }

  async remove(parts: string[]): Promise<void> {
    let identity: { dev: number; ino: number } | null = null;
    await retryTransient(async () => {
      const target = await this.resolve(parts, 'file');
      if (!target) return;
      const info = await lstat(target);
      if (identity && (identity.dev !== info.dev || identity.ino !== info.ino))
        throw new ProjectError(
          'CONFLICT',
          'The historical snapshot changed before removal. Refresh before trying again.',
        );
      identity = { dev: info.dev, ino: info.ino };
      await unlink(target);
    });
  }

  async directories(parts: string[], maximum: number): Promise<string[]> {
    const target = await this.resolve(parts, 'directory');
    if (!target) return [];
    const names: string[] = [];
    const directory = await opendir(target);
    for await (const entry of directory) {
      if (names.length >= maximum)
        throw new ProjectError(
          'HISTORY_LIMIT',
          'Too many legacy history stores to inspect safely.',
        );
      if (entry.isDirectory() || entry.isSymbolicLink()) names.push(entry.name);
    }
    return names;
  }
}
