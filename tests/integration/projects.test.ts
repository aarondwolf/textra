import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../../src/main/services/projects';
import type { ProjectInfo } from '../../src/shared/api';

describe('real project files and data preservation', () => {
  let directory: string;
  let root: string;
  let service: ProjectService;
  let project: ProjectInfo;

  beforeEach(async () => {
    const testRoot = join(process.cwd(), '.test-data', 'project-tests');
    await mkdir(testRoot, { recursive: true });
    directory = await mkdtemp(join(testRoot, 'case-'));
    root = join(directory, 'résumé project with spaces');
    await mkdir(join(root, 'chapters'), { recursive: true });
    await writeFile(join(root, 'main.tex'), '\\documentclass{article}\nOriginal café.\n', 'utf8');
    await writeFile(join(root, 'chapters', 'one.tex'), 'First chapter.\n', 'utf8');
    service = new ProjectService(join(directory, 'user-data'));
    project = await service.openRoot(root);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('opens a Unicode/spaced root, lists files, and reads exact UTF-8 content', async () => {
    expect(project.rootPath).toBe(root);
    expect(project.mainFile).toBe('main.tex');
    expect(project.files.map((entry) => entry.path)).toContain('chapters/one.tex');
    const snapshot = await service.readFile({ projectId: project.id, path: 'main.tex' });
    expect(snapshot.content).toBe('\\documentclass{article}\nOriginal café.\n');
    expect(snapshot.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(service.getRoot(project.id)).toBe(root);
  });

  it('saves a matching revision atomically without leftover temporary files', async () => {
    const reference = { projectId: project.id, path: 'main.tex' };
    const before = await service.readFile(reference);
    const saved = await service.saveFile({
      ...reference,
      expectedRevision: before.revision,
      content: 'Saved café and α.\n',
    });
    expect(saved.content).toBe('Saved café and α.\n');
    expect(saved.revision).not.toBe(before.revision);
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(saved.content);
    expect((await readdir(root)).sort()).toEqual(['chapters', 'main.tex']);
  });

  it('preserves an external edit when a stale buffer tries to save', async () => {
    const reference = { projectId: project.id, path: 'main.tex' };
    const before = await service.readFile(reference);
    await writeFile(join(root, 'main.tex'), 'External content.\n', 'utf8');
    await expect(
      service.saveFile({
        ...reference,
        expectedRevision: before.revision,
        content: 'Stale buffer.',
      }),
    ).rejects.toThrow();
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe('External content.\n');
    expect(await service.getFileRevisions({ projectId: project.id, paths: ['main.tex'] })).toEqual([
      { path: 'main.tex', revision: (await service.readFile(reference)).revision },
    ]);
  });

  it('rejects stale project sessions without touching the newly selected root', async () => {
    const oldReference = { projectId: project.id, path: 'main.tex' };
    const oldSnapshot = await service.readFile(oldReference);
    const secondRoot = join(directory, 'second');
    await mkdir(secondRoot);
    await writeFile(join(secondRoot, 'main.tex'), 'Second project.', 'utf8');
    const second = await service.openRoot(secondRoot);
    expect(second.id).not.toBe(project.id);
    await expect(service.readFile(oldReference)).rejects.toThrow();
    await expect(
      service.saveFile({
        ...oldReference,
        expectedRevision: oldSnapshot.revision,
        content: 'Wrong.',
      }),
    ).rejects.toThrow();
    expect(await readFile(join(secondRoot, 'main.tex'), 'utf8')).toBe('Second project.');
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(oldSnapshot.content);
  });

  it('creates and renames entries but never overwrites an existing destination', async () => {
    await service.createEntry({ projectId: project.id, path: 'notes', kind: 'directory' });
    await service.createEntry({
      projectId: project.id,
      path: 'notes/draft.tex',
      kind: 'file',
      content: 'A new draft.',
    });
    await service.renameEntry({
      projectId: project.id,
      path: 'notes/draft.tex',
      newPath: 'notes/final.tex',
    });
    expect(await readFile(join(root, 'notes', 'final.tex'), 'utf8')).toBe('A new draft.');
    await expect(
      service.createEntry({
        projectId: project.id,
        path: 'main.tex',
        kind: 'file',
        content: 'Bad.',
      }),
    ).rejects.toThrow();
    await expect(
      service.renameEntry({ projectId: project.id, path: 'notes/final.tex', newPath: 'main.tex' }),
    ).rejects.toThrow();
    expect(await readFile(join(root, 'notes', 'final.tex'), 'utf8')).toBe('A new draft.');
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('Original café.');
  });

  it('deletes only the validated entry through the supplied trash operation', async () => {
    const deleted: string[] = [];
    await service.deleteEntry(
      { projectId: project.id, path: 'chapters/one.tex' },
      async (filename) => {
        deleted.push(filename);
        await rm(filename);
      },
    );
    expect(deleted).toEqual([join(root, 'chapters', 'one.tex')]);
    expect(
      await service.getFileRevisions({ projectId: project.id, paths: ['chapters/one.tex'] }),
    ).toEqual([{ path: 'chapters/one.tex', revision: null }]);
    await expect(
      service.deleteEntry({ projectId: project.id, path: '../outside.tex' }, async () => {
        throw new Error('The trash callback must not be invoked.');
      }),
    ).rejects.toThrow();
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('Original café.');
  });

  it('rejects invalid UTF-8, binary text, and files above the editing limit', async () => {
    await writeFile(join(root, 'invalid.tex'), Buffer.from([0xc3, 0x28]));
    await writeFile(join(root, 'binary.tex'), Buffer.from([65, 0, 66]));
    await writeFile(join(root, 'huge.tex'), Buffer.alloc(5 * 1024 * 1024 + 1, 65));
    for (const path of ['invalid.tex', 'binary.tex', 'huge.tex']) {
      await expect(service.readFile({ projectId: project.id, path })).rejects.toThrow();
    }
  });

  it('rejects directory symlinks even when they point inside the project', async () => {
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'private.tex'), 'Outside data.');
    await symlink(outside, join(root, 'escape'), 'junction');
    await symlink(join(root, 'chapters'), join(root, 'alias'), 'junction');
    for (const path of ['escape/private.tex', 'alias/one.tex']) {
      await expect(service.readFile({ projectId: project.id, path })).rejects.toThrow();
    }
    await expect(
      service.createEntry({ projectId: project.id, path: 'escape/new.tex', kind: 'file' }),
    ).rejects.toThrow();
    expect(await readdir(outside)).toEqual(['private.tex']);
  });

  it('stores recent roots and pins without reusing an expired session', async () => {
    const recent = await service.getRecentProjects();
    const entry = recent.find((item) => item.rootPath === root);
    expect(entry).toBeDefined();
    if (!entry) throw new Error('Expected recent project.');
    await service.setProjectPinned({ id: entry.id, pinned: true });
    const reopened = new ProjectService(join(directory, 'user-data'));
    expect(await reopened.getRecentProjects()).toContainEqual({ ...entry, pinned: true });
    const loaded = await reopened.openRecentProject(entry.id);
    expect(loaded.rootPath).toBe(root);
    expect(loaded.id).not.toBe(project.id);
  });
});
