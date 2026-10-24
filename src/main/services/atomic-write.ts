import { open, rename, link, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { retryTransient } from './retry';

export interface AtomicWriteOptions {
  /** Mode for temporary file creation. Defaults to 0o600. */
  mode?: number;
  /** Prefix for the temporary file name. Defaults to 'tmp'. */
  prefix?: string;
  /** Optional directory for the temporary file. Defaults to dirname(target). */
  tempDirectory?: string;
  /** Optional encoding if writing string. Defaults to 'utf8'. */
  encoding?: BufferEncoding;
  /** If true, ensures the directory exists via mkdir recursive. */
  ensureDir?: boolean;
  /**
   * Optional pre-publish validation hook run after file is written and flushed,
   * but before replacement occurs. If this hook throws, replacement is aborted
   * and the temporary file is unlinked.
   */
  prePublish?: (temporaryPath: string) => Promise<void> | void;
  /**
   * Publish strategy:
   * - 'rename' (default): replace target with temporary file (atomic rename).
   * - 'link': hard-link temporary to target (fails if target already exists, ensuring create-new-only).
   * - Custom function: `(temporary: string, target: string) => Promise<void>`
   */
  publish?: 'rename' | 'link' | ((temporary: string, target: string) => Promise<void>);
}

function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

/**
 * Atomically writes data to `target` by first creating an unguessable temporary file
 * with exclusive creation flag ('wx'), writing and syncing contents to disk,
 * running optional prePublish validation, and atomically publishing (via rename or link)
 * with retry on transient Windows locks.
 * Guarantees cleanup of temporary file if any step fails.
 */
export async function writeAtomic(
  target: string,
  content: string | NodeJS.ArrayBufferView,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const dir = options.tempDirectory ?? dirname(target);
  if (options.ensureDir) {
    await mkdir(dir, { recursive: true });
  }
  const prefix = options.prefix ? `.${options.prefix}-` : '.tmp-';
  const temporary = join(dir, `${prefix}${randomUUID()}.tmp`);
  const mode = options.mode ?? 0o600;

  try {
    const file = await open(temporary, 'wx', mode);
    try {
      if (typeof content === 'string') {
        await file.writeFile(content, options.encoding ?? 'utf8');
      } else {
        await file.writeFile(content);
      }
      await file.sync();
    } finally {
      await file.close();
    }

    if (options.prePublish) {
      await options.prePublish(temporary);
    }

    const publish = options.publish ?? 'rename';
    if (typeof publish === 'function') {
      await retryTransient(() => publish(temporary, target));
    } else if (publish === 'link') {
      await retryTransient(() => link(temporary, target));
    } else {
      await retryTransient(() => rename(temporary, target));
    }
  } finally {
    await retryTransient(() => unlink(temporary)).catch((error: unknown) => {
      if (!isMissing(error)) throw error;
    });
  }
}
