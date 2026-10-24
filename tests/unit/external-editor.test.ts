import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExternalEditorService } from '../../src/main/services/external-editor';
import { ProjectService } from '../../src/main/services/projects';
import type { ProjectInfo } from '../../src/shared/api';

describe('external editor safety service', () => {
  let directory: string;
  let project: ProjectInfo;
  let service: ExternalEditorService;

  beforeEach(async () => {
    const testRoot = join(process.cwd(), '.test-data', 'external-editor-tests');
    await mkdir(testRoot, { recursive: true });
    directory = await mkdtemp(join(testRoot, 'case-'));
    await writeFile(join(directory, 'chapter.tex'), 'External original.\n', 'utf8');
    const projects = new ProjectService(join(directory, 'user-data'));
    project = await projects.openRoot(directory);
    service = new ExternalEditorService(projects);
  });

  afterEach(async () => {
    service.clear();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('creates collision-safe sibling conflict snapshots without touching the external file', async () => {
    const ref = { projectId: project.id, path: 'chapter.tex' };
    const first = await service.createConflictCopy({ ...ref, content: 'My TeXtra edit.\n' });
    const second = await service.createConflictCopy({ ...ref, content: 'A later snapshot.\n' });

    expect(first.path).toMatch(/^chapter\.CONFLICTED_\d{4}-\d{2}-\d{2}_\d{6}\.tex$/);
    expect(second.path).toMatch(/^chapter\.CONFLICTED_\d{4}-\d{2}-\d{2}_\d{6}(_2)?\.tex$/);
    expect(await readFile(join(directory, 'chapter.tex'), 'utf8')).toBe('External original.\n');
    expect(await readFile(join(directory, first.path), 'utf8')).toBe('My TeXtra edit.\n');
    expect(await readFile(join(directory, second.path), 'utf8')).toBe('A later snapshot.\n');
  });

  it('detects a polling-only external replacement without writing the open file', async () => {
    const ref = { projectId: project.id, path: 'chapter.tex' };
    const change = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('External change was not detected.')),
        4000,
      );
      const unsubscribe = service.onChange((event) => {
        if (event.path === ref.path && event.state === 'changing') {
          clearTimeout(timeout);
          unsubscribe();
          resolve(event.revision ?? '');
        }
      });
    });
    await service.watch({ ...ref, pollingOnly: true, quietPeriodMs: 2000 });
    await writeFile(join(directory, 'chapter.tex'), 'Changed by another editor.\n', 'utf8');

    await expect(change).resolves.toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(join(directory, 'chapter.tex'), 'utf8')).toBe(
      'Changed by another editor.\n',
    );
  });

  it('avoids re-reading full file content when stat mtime and size are unchanged during polling', async () => {
    const ref = { projectId: project.id, path: 'chapter.tex' };
    const projects = (service as unknown as { projects: ProjectService }).projects;
    let readCount = 0;
    const originalReadFile = projects.readFile.bind(projects);
    projects.readFile = async (targetRef) => {
      readCount++;
      return originalReadFile(targetRef);
    };

    await service.watch({ ...ref, pollingOnly: true, quietPeriodMs: 2000 });
    expect(readCount).toBe(1);

    // Wait for at least one polling cycle (POLL_INTERVAL_MS = 750ms)
    await new Promise((resolve) => setTimeout(resolve, 900));

    // readCount must still be 1 because stat mtime and size did not change
    expect(readCount).toBe(1);
  });
});
