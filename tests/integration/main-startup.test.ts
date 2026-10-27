import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../../src/main/services/projects';
import { BuildService } from '../../src/main/services/latex';

describe('document-first project activation and restored previews', () => {
  let directory: string;
  let root: string;
  let userData: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'textra-startup-'));
    root = join(directory, 'project');
    userData = join(directory, 'user-data');
    await mkdir(join(root, 'chapters'), { recursive: true });
    await writeFile(join(root, 'chapters', 'one.tex'), 'Chapter');
    await writeFile(join(root, 'main.tex'), '\\documentclass{article}');
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads a known nested document before completing the tree and flushes recents', async () => {
    const service = new ProjectService(userData);
    const project = await service.openRoot(root, { initialTree: true });
    expect(project.treeState).toBe('partial');
    expect(project.files.map((entry) => entry.path)).not.toContain('chapters/one.tex');
    expect(
      (await service.readFile({ projectId: project.id, path: 'chapters/one.tex' })).content,
    ).toBe('Chapter');
    const complete = await service.refreshProject(project.id);
    expect(complete.treeState).toBe('partial');
    expect(complete.files.map((entry) => entry.path)).not.toContain('chapters/one.tex');
    expect(
      (await service.listDirectory({ projectId: project.id, path: 'chapters' })).entries.map(
        (entry) => entry.path,
      ),
    ).toContain('chapters/one.tex');
    await service.flush();
    expect(await service.getRecentProjects()).toHaveLength(1);
    expect((await service.openRoot(root)).treeState).toBe('partial');
  });

  async function cachedPdf() {
    const project = await new ProjectService(userData).openRoot(root);
    const path = 'last.pdf';
    const bytes = Buffer.from('%PDF-1.7\nfixture');
    await writeFile(join(root, path), bytes);
    const info = await lstat(join(root, path), { bigint: true });
    const metadata = {
      schemaVersion: 1,
      root: project.rootPath,
      rootFile: 'main.tex',
      path,
      recipeId: 'pdflatex',
      compiledAt: '2026-10-23T12:00:00.000Z',
      fingerprint: `${info.ino}:${info.size}:${info.mtimeNs}`,
      digest: createHash('sha256').update(bytes).digest('hex'),
    };
    await mkdir(join(userData, 'last-pdfs'), { recursive: true });
    const cache = join(
      userData,
      'last-pdfs',
      `${createHash('sha256').update(project.rootPath).digest('hex')}.json`,
    );
    await writeFile(cache, JSON.stringify(metadata));
    const service = new BuildService(
      (id) => {
        if (id !== project.id) throw Error('stale');
        return project.rootPath;
      },
      1000,
      userData,
    );
    return { service, project, cache, metadata, bytes };
  }

  it('restores only validated bytes without making SyncTeX available or changing build state', async () => {
    const { service, project, bytes } = await cachedPdf();
    const pdf = await service.restoreLastPdf(project.id);
    expect(pdf).toMatchObject({
      projectId: project.id,
      rootFile: 'main.tex',
      path: 'last.pdf',
      recipeId: 'pdflatex',
    });
    expect(await service.readPdf({ projectId: project.id, path: 'last.pdf' })).toEqual(
      new Uint8Array(bytes),
    );
    expect(service.getState().outcome).toBe('idle');
    await expect(
      service.syncForward({
        projectId: project.id,
        rootFile: 'main.tex',
        path: 'main.tex',
        line: 1,
      }),
    ).rejects.toThrow('Compile this root');
  });

  it('rejects changed, missing and escaping cached output', async () => {
    const { service, project, cache, metadata } = await cachedPdf();
    await writeFile(join(root, 'last.pdf'), '%PDF-1.7\nchanged');
    expect(await service.restoreLastPdf(project.id)).toBeNull();
    await rm(join(root, 'last.pdf'));
    expect(await service.restoreLastPdf(project.id)).toBeNull();
    await writeFile(cache, JSON.stringify({ ...metadata, path: '../outside.pdf' }));
    expect(await service.restoreLastPdf(project.id)).toBeNull();
    expect(JSON.parse(await readFile(cache, 'utf8')).path).toBe('../outside.pdf');
  });
});
