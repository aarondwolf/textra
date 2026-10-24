import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectService } from '../../src/main/services/projects';
import { ConfigService } from '../../src/main/services/settings';

const intercept = vi.hoisted(() => ({
  target: '',
  remainingStats: 0,
  handleStat: false,
  afterStat: null as null | (() => Promise<void>),
}));

// Inject only the external writer's timing. Reads and all filesystem operations are real.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const info = await actual.lstat(...args);
      if (
        String(args[0]) === intercept.target &&
        !intercept.handleStat &&
        --intercept.remainingStats === 0
      )
        await intercept.afterStat?.();
      return info;
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      if (String(args[0]) === intercept.target && intercept.handleStat) {
        const originalStat = file.stat.bind(file);
        Object.defineProperty(file, 'stat', {
          value: async () => {
            const info = await originalStat();
            await intercept.afterStat?.();
            return info;
          },
        });
      }
      return file;
    },
  };
});

describe('external growth between metadata and reading', () => {
  let directory: string;
  let root: string;
  let projects: ProjectService;
  let projectId: string;
  beforeEach(async () => {
    intercept.target = '';
    intercept.remainingStats = 0;
    intercept.handleStat = false;
    intercept.afterStat = null;
    const base = join(process.cwd(), '.test-data', 'storage-growth');
    await mkdir(base, { recursive: true });
    directory = await mkdtemp(join(base, 'case-'));
    root = join(directory, 'project');
    await mkdir(root);
    await writeFile(join(root, 'main.tex'), 'a'.repeat(1000));
    projects = new ProjectService(join(directory, 'user-data'));
    projectId = (await projects.openRoot(root)).id;
  });
  afterEach(async () => {
    intercept.target = '';
    await projects.flush();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('returns the complete project text when it grows beyond the old allocation headroom', async () => {
    intercept.target = join(root, 'main.tex');
    intercept.remainingStats = 2;
    intercept.afterStat = () => writeFile(intercept.target, 'b'.repeat(12000));
    const result = await projects.readFile({ projectId, path: 'main.tex' });
    expect(result.content).toBe('b'.repeat(12000));
  });

  it('reads complete project settings after handle metadata becomes stale', async () => {
    await mkdir(join(root, '.textra'));
    intercept.target = join(root, '.textra', 'settings.json');
    await writeFile(intercept.target, '{}');
    intercept.handleStat = true;
    intercept.afterStat = () => writeFile(intercept.target, '{"engine":"xelatex"}');
    const config = new ConfigService(directory, (id) => projects.getRoot(id));
    expect((await config.getProjectConfig(projectId)).engine).toBe('xelatex');
  });

  it('rejects PDFs which grow beyond the 64 MiB cap after metadata validation', async () => {
    const path = join(root, 'main.pdf');
    await writeFile(path, '%PDF-1.7\nsmall');
    intercept.target = path;
    intercept.remainingStats = 2;
    intercept.afterStat = () => truncate(path, 64 * 1024 * 1024 + 1);
    await expect(projects.readProjectPdf({ projectId, path: 'main.pdf' })).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });
});
