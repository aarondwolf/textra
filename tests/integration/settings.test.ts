import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService, DEFAULT_PROJECT_CONFIG } from '../../src/main/services/settings';
import { ProjectService } from '../../src/main/services/projects';

describe('safe project settings persistence', () => {
  let directory: string;
  let root: string;
  let projectId: string;
  let projects: ProjectService;
  let service: ConfigService;

  beforeEach(async () => {
    const testRoot = join(process.cwd(), '.test-data', 'settings-tests');
    await mkdir(testRoot, { recursive: true });
    directory = await mkdtemp(join(testRoot, 'case-'));
    root = join(directory, 'résumé project');
    await mkdir(root);
    const userData = join(directory, 'user-data');
    projects = new ProjectService(userData);
    projectId = (await projects.openRoot(root)).id;
    service = new ConfigService(userData, (id) => projects.getRoot(id));
  });

  afterEach(async () => {
    await service.flush();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('returns defaults without creating a settings directory and round-trips overrides', async () => {
    expect(await service.getProjectConfig(projectId)).toEqual(DEFAULT_PROJECT_CONFIG);
    expect(await readdir(root)).toEqual([]);
    const config = {
      schemaVersion: 1 as const,
      rootFile: 'chapters/main.tex',
      engine: 'xelatex' as const,
    };
    await service.setProjectConfig({ projectId, config });
    expect(await service.getProjectConfig(projectId)).toEqual(config);
    const reopened = new ConfigService(directory, (id) => projects.getRoot(id));
    expect(await reopened.getProjectConfig(projectId)).toEqual(config);
    expect(JSON.parse(await readFile(join(root, '.textra', 'project.json'), 'utf8'))).toEqual(
      config,
    );
    expect(await readdir(join(root, '.textra'))).toEqual(['project.json']);
  });

  it.each([
    '{corrupt JSON',
    JSON.stringify({ ...DEFAULT_PROJECT_CONFIG, schemaVersion: 2 }),
    JSON.stringify({ ...DEFAULT_PROJECT_CONFIG, credentials: 'secret' }),
    ' '.repeat(1024 * 1024 + 1),
  ])(
    'preserves corrupt or unsupported settings when read or write is attempted',
    async (original) => {
      await mkdir(join(root, '.textra'));
      const filename = join(root, '.textra', 'project.json');
      await writeFile(filename, original);
      await expect(service.getProjectConfig(projectId)).rejects.toThrow();
      await expect(
        service.setProjectConfig({ projectId, config: DEFAULT_PROJECT_CONFIG }),
      ).rejects.toThrow();
      expect(await readFile(filename, 'utf8')).toBe(original);
      expect(await readdir(join(root, '.textra'))).toEqual(['project.json']);
    },
  );

  it('rejects a junction settings directory without touching the linked folder', async () => {
    const outside = join(directory, 'outside');
    await mkdir(outside);
    const filename = join(outside, 'project.json');
    const original = JSON.stringify(DEFAULT_PROJECT_CONFIG);
    await writeFile(filename, original);
    await symlink(outside, join(root, '.textra'), 'junction');
    await expect(service.getProjectConfig(projectId)).rejects.toThrow();
    await expect(
      service.setProjectConfig({ projectId, config: DEFAULT_PROJECT_CONFIG }),
    ).rejects.toThrow();
    expect(await readFile(filename, 'utf8')).toBe(original);
    expect(await readdir(outside)).toEqual(['project.json']);
  });

  it('rejects a directory at the config filename', async () => {
    await mkdir(join(root, '.textra', 'project.json'), { recursive: true });
    await expect(service.getProjectConfig(projectId)).rejects.toThrow();
    await expect(
      service.setProjectConfig({ projectId, config: DEFAULT_PROJECT_CONFIG }),
    ).rejects.toThrow();
  });

  it('rejects a junction at the config filename without reading or replacing its target', async () => {
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'preserved.txt'), 'Outside content.');
    await mkdir(join(root, '.textra'));
    await symlink(outside, join(root, '.textra', 'project.json'), 'junction');
    await expect(service.getProjectConfig(projectId)).rejects.toThrow();
    await expect(
      service.setProjectConfig({ projectId, config: DEFAULT_PROJECT_CONFIG }),
    ).rejects.toThrow();
    expect(await readdir(outside)).toEqual(['preserved.txt']);
    expect(await readFile(join(outside, 'preserved.txt'), 'utf8')).toBe('Outside content.');
  });

  it('serializes writes and recovers after rejected input', async () => {
    const config = { ...DEFAULT_PROJECT_CONFIG, rootFile: 'main.tex' };
    await expect(
      service.setProjectConfig({ projectId, config: { ...config, rootFile: '../bad.tex' } }),
    ).rejects.toThrow();
    await Promise.all([
      service.setProjectConfig({ projectId, config }),
      service.setProjectConfig({ projectId, config: { ...config, engine: 'latexmk' } }),
    ]);
    expect(await service.getProjectConfig(projectId)).toEqual({ ...config, engine: 'latexmk' });
    expect(await readdir(join(root, '.textra'))).toEqual(['project.json']);
  });

  it('rejects stale project identifiers and leaves both project folders untouched', async () => {
    const nextRoot = join(directory, 'next-project');
    await mkdir(nextRoot);
    await projects.openRoot(nextRoot);
    await expect(service.getProjectConfig(projectId)).rejects.toThrow();
    await expect(
      service.setProjectConfig({ projectId, config: DEFAULT_PROJECT_CONFIG }),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
    expect(await readdir(nextRoot)).toEqual([]);
  });
});
