import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../../src/main/services/settings';

// Inject only OS lock failures; all reads, writes, publication, and cleanup use the real filesystem.
const locks = vi.hoisted(() => ({
  target: '',
  rename: 0,
  link: 0,
  unlink: 0,
  edit: '',
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (String(args[1]) === locks.target && locks.rename > 0) {
        locks.rename--;
        if (locks.edit) await actual.writeFile(locks.target, locks.edit);
        throw Object.assign(new Error('Temporary sharing lock'), { code: 'EPERM' });
      }
      return actual.rename(...args);
    },
    link: async (...args: Parameters<typeof actual.link>) => {
      if (String(args[1]) === locks.target && locks.link > 0) {
        locks.link--;
        throw Object.assign(new Error('Temporary sharing lock'), { code: 'EBUSY' });
      }
      return actual.link(...args);
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (String(args[0]).includes('.settings-') && locks.unlink > 0) {
        locks.unlink--;
        throw Object.assign(new Error('Temporary sharing lock'), { code: 'EACCES' });
      }
      return actual.unlink(...args);
    },
  };
});

describe('project settings with transient Windows filesystem locks', () => {
  let root: string;
  let service: ConfigService;

  beforeEach(async () => {
    const parent = join(process.cwd(), '.test-data', 'settings-retry');
    await mkdir(parent, { recursive: true });
    root = await mkdtemp(join(parent, 'case-'));
    Object.assign(locks, {
      target: join(root, '.textra', 'settings.json'),
      rename: 0,
      link: 0,
      unlink: 0,
      edit: '',
    });
    service = new ConfigService(root, () => root);
  });

  afterEach(async () => {
    await service.flush();
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('retries exclusive creation, replacement, and temporary-file cleanup', async () => {
    locks.link = 1;
    locks.unlink = 1;
    const config = await service.ensureProjectConfig('project');
    locks.rename = 2;
    const next = { ...config, engine: 'xelatex' as const };
    await expect(
      service.setProjectConfig({ projectId: 'project', config: next, expectedConfig: config }),
    ).resolves.toEqual(next);
    expect(JSON.parse(await readFile(locks.target, 'utf8'))).toEqual(next);
    expect(await readdir(join(root, '.textra'))).toEqual(['settings.json']);
    expect([locks.rename, locks.link, locks.unlink]).toEqual([0, 0, 0]);
  });

  it('detects an external edit during the retry delay and preserves it', async () => {
    const config = await service.ensureProjectConfig('project');
    locks.rename = 1;
    locks.edit = JSON.stringify({ ...config, engine: 'lualatex' });
    await expect(
      service.setProjectConfig({
        projectId: 'project',
        config: { ...config, engine: 'xelatex' },
        expectedConfig: config,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(locks.target, 'utf8')).toBe(locks.edit);
    expect(await readdir(join(root, '.textra'))).toEqual(['settings.json']);
  });
});
