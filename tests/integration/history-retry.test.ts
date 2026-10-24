import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryStorage } from '../../src/main/services/history-storage';

async function mutateFixture(action: () => Promise<void>): Promise<void> {
  const waits = [50, 100, 200, 400, 800];
  for (let attempt = 0; ; attempt++) {
    try {
      await action();
      return;
    } catch (error) {
      if (
        attempt >= waits.length ||
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        !['EPERM', 'EBUSY', 'EACCES'].includes(String(error.code))
      )
        throw error;
      await delay(waits[attempt]);
    }
  }
}

// Inject only OS lock errors and the exact external mutation during their delay.
// Publication, verification, links, directory swaps and cleanup use real files.
const locks = vi.hoisted(() => ({
  target: '',
  rename: 0,
  link: 0,
  unlink: 0,
  unlinkTarget: '',
  renameAttempts: 0,
  linkAttempts: 0,
  unlinkAttempts: 0,
  afterFailure: null as null | (() => Promise<void>),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const sharingLock = (code: string) =>
    Object.assign(new Error('Temporary sharing lock'), { code });
  const afterFailure = async () => {
    const mutate = locks.afterFailure;
    locks.afterFailure = null;
    await mutate?.();
  };
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (String(args[1]) === locks.target) {
        locks.renameAttempts++;
        if (locks.rename > 0) {
          locks.rename--;
          await afterFailure();
          throw sharingLock('EPERM');
        }
      }
      return actual.rename(...args);
    },
    link: async (...args: Parameters<typeof actual.link>) => {
      if (String(args[1]) === locks.target) {
        locks.linkAttempts++;
        if (locks.link > 0) {
          locks.link--;
          await afterFailure();
          throw sharingLock('EBUSY');
        }
      }
      return actual.link(...args);
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      const target = String(args[0]);
      if (locks.unlinkTarget ? target === locks.unlinkTarget : target.includes('.history-')) {
        locks.unlinkAttempts++;
        if (locks.unlink > 0) {
          locks.unlink--;
          await afterFailure();
          throw sharingLock('EACCES');
        }
      }
      return actual.unlink(...args);
    },
  };
});

describe('history storage with Windows sharing locks', () => {
  let root: string;
  let storage: HistoryStorage;
  const parts = ['.textra', 'history', 'index.json'];
  const maximum = 1024;
  beforeEach(async () => {
    const parent = join(process.cwd(), '.test-data', 'history-retry');
    await mkdir(parent, { recursive: true });
    root = await realpath(await mkdtemp(join(parent, 'case-')));
    Object.assign(locks, {
      target: join(root, ...parts),
      rename: 0,
      link: 0,
      unlink: 0,
      unlinkTarget: '',
      renameAttempts: 0,
      linkAttempts: 0,
      unlinkAttempts: 0,
      afterFailure: null,
    });
    storage = new HistoryStorage(root);
  });
  afterEach(async () => {
    locks.afterFailure = null;
    locks.rename = locks.link = locks.unlink = 0;
    // The resolved root is a disposable fixture beneath this workspace's .test-data.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('retries exclusive publication, replacement and its temporary cleanup', async () => {
    locks.link = 2;
    locks.unlink = 1;
    const original = Buffer.from('original index');
    await storage.write(parts, original, null, maximum);
    expect(await storage.read(parts, maximum)).toEqual(original);
    expect(locks.linkAttempts).toBeGreaterThanOrEqual(3);
    expect(locks.linkAttempts).toBeLessThanOrEqual(6);
    expect(locks.unlinkAttempts).toBeGreaterThanOrEqual(2);
    expect(locks.unlinkAttempts).toBeLessThanOrEqual(6);
    locks.rename = 2;
    const updated = Buffer.from('updated index');
    await storage.write(parts, updated, original, maximum);
    expect(await readFile(locks.target)).toEqual(updated);
    expect(locks.renameAttempts).toBeGreaterThanOrEqual(3);
    expect(locks.renameAttempts).toBeLessThanOrEqual(6);
    expect([locks.link, locks.unlink, locks.rename]).toEqual([0, 0, 0]);
    expect(await readdir(dirname(locks.target))).toEqual(['index.json']);
  });

  it('preserves an external index edit made during the rename retry delay', async () => {
    const original = Buffer.from('original index');
    await storage.write(parts, original, null, maximum);
    locks.rename = 1;
    locks.afterFailure = () => writeFile(locks.target, 'external edit');
    await expect(
      storage.write(parts, Buffer.from('stale replacement'), original, maximum),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(locks.target, 'utf8')).toBe('external edit');
    expect(locks.renameAttempts).toBe(1);
    expect(await readdir(dirname(locks.target))).toEqual(['index.json']);
  });

  it('preserves an external file created during the exclusive-link retry delay', async () => {
    locks.link = 1;
    locks.afterFailure = () => writeFile(locks.target, 'external creation');
    await expect(
      storage.write(parts, Buffer.from('new index'), null, maximum),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(locks.target, 'utf8')).toBe('external creation');
    expect(locks.linkAttempts).toBe(1);
    expect(await readdir(dirname(locks.target))).toEqual(['index.json']);
  });

  it('fails safely if a history directory becomes a junction during publication retry', async () => {
    const original = Buffer.from('original index');
    await storage.write(parts, original, null, maximum);
    const outside = join(root, 'outside');
    const retained = join(root, '.textra', 'retained-history');
    await mkdir(outside);
    await writeFile(join(outside, 'index.json'), 'outside index');
    locks.rename = 1;
    locks.afterFailure = async () => {
      await mutateFixture(() => rename(dirname(locks.target), retained));
      await mutateFixture(() =>
        symlink(outside, dirname(locks.target), process.platform === 'win32' ? 'junction' : 'dir'),
      );
    };
    await expect(
      storage.write(parts, Buffer.from('replacement'), original, maximum),
    ).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await readFile(join(outside, 'index.json'), 'utf8')).toBe('outside index');
    expect(await readFile(join(retained, 'index.json'))).toEqual(original);
    expect(locks.renameAttempts).toBe(1);
  });

  it('revalidates the cleanup parent after a transient unlink failure', async () => {
    const outside = join(root, 'outside');
    const retained = join(root, '.textra', 'retained-history');
    await mkdir(outside);
    await writeFile(join(outside, 'keep.txt'), 'outside data');
    locks.unlink = 1;
    locks.afterFailure = async () => {
      await mutateFixture(() => rename(dirname(locks.target), retained));
      await mutateFixture(() =>
        symlink(outside, dirname(locks.target), process.platform === 'win32' ? 'junction' : 'dir'),
      );
    };
    await expect(
      storage.write(parts, Buffer.from('new index'), null, maximum),
    ).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await readdir(outside)).toEqual(['keep.txt']);
    expect(await readFile(join(retained, 'index.json'), 'utf8')).toBe('new index');
    expect(locks.unlinkAttempts).toBe(1);
  });

  it('retries snapshot removal without leaving the file behind', async () => {
    const snapshotParts = ['.textra', 'history', 'main.tex.snapshot.gz'];
    await storage.write(snapshotParts, Buffer.from('compressed snapshot fixture'), null, maximum);
    locks.unlinkTarget = join(root, ...snapshotParts);
    locks.unlink = 2;
    locks.unlinkAttempts = 0;
    await storage.remove(snapshotParts);
    expect(await storage.read(snapshotParts, maximum)).toBeNull();
    expect(locks.unlinkAttempts).toBe(3);
  });

  it('bounds permanent sharing failures and preserves the original index', async () => {
    const original = Buffer.from('original index');
    await storage.write(parts, original, null, maximum);
    locks.rename = 20;
    await expect(
      storage.write(parts, Buffer.from('replacement'), original, maximum),
    ).rejects.toMatchObject({ code: 'EPERM' });
    expect(locks.renameAttempts).toBe(6);
    expect(await readFile(locks.target)).toEqual(original);
    expect(await readdir(dirname(locks.target))).toEqual(['index.json']);
  });
});
