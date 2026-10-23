import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HistoryService } from '../../src/main/services/history';
import { ProjectService } from '../../src/main/services/projects';
import type { ProjectInfo } from '../../src/shared/api';

const gzipAsync = promisify(gzip);

describe('flat-file compressed automatic file history', () => {
  let directory: string;
  let root: string;
  let projects: ProjectService;
  let history: HistoryService;
  let project: ProjectInfo;

  beforeEach(async () => {
    const testRoot = join(process.cwd(), '.test-data', 'history-tests');
    await mkdir(testRoot, { recursive: true });
    directory = await mkdtemp(join(testRoot, 'case-'));
    root = join(directory, 'history-project');
    await mkdir(join(root, 'sections'), { recursive: true });
    await writeFile(
      join(root, 'main.tex'),
      '\\documentclass{article}\n\\begin{document}\nInitial content café α.\n\\end{document}\n',
      'utf8',
    );
    await writeFile(join(root, 'sections', 'intro.tex'), 'Intro text.\n', 'utf8');

    projects = new ProjectService(join(directory, 'user-data'));
    project = await projects.openRoot(root);
    history = new HistoryService(projects);
  });

  afterEach(async () => {
    await history.flush();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('compresses snapshots with gzip and reads them back faithfully', async () => {
    const content =
      '\\documentclass{article}\n\\begin{document}\nSnapshot content with Unicode: café, α, 𝄞.\n\\end{document}\n';
    const snapshot = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content,
      trigger: 'save',
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.path).toBe('main.tex');
    expect(snapshot!.trigger).toBe('save');
    expect(snapshot!.pinned).toBe(false);

    // Verify compressed file exists on disk inside .textra/history
    const historyDir = join(root, '.textra', 'history');
    const files = await readdir(historyDir);
    expect(files).toContain('index.json');
    const gzFile = files.find((f) => f.startsWith('main.tex.') && f.endsWith('.gz'));
    expect(gzFile).toBeDefined();

    // Verify reading snapshot decompresses exact text
    const readBack = await history.read({
      projectId: project.id,
      path: 'main.tex',
      snapshotId: snapshot!.id,
    });
    expect(readBack.content).toBe(content);
    expect(readBack.revision).toBe(snapshot!.revision);
  });

  it('skips redundant snapshots with identical content unless forced', async () => {
    const content = 'Identical document content.\n';

    const first = await history.create({
      projectId: project.id,
      path: 'sections/intro.tex',
      content,
      trigger: 'save',
    });
    expect(first).not.toBeNull();

    // Second snapshot with identical content and force: false should return existing
    const second = await history.create({
      projectId: project.id,
      path: 'sections/intro.tex',
      content,
      trigger: 'interval',
    });
    expect(second!.id).toBe(first!.id);

    const list = await history.list({ projectId: project.id, path: 'sections/intro.tex' });
    expect(list.length).toBe(1);

    // Forced snapshot creates a new snapshot even if content is identical
    const third = await history.create({
      projectId: project.id,
      path: 'sections/intro.tex',
      content,
      trigger: 'manual',
      force: true,
    });
    expect(third).not.toBeNull();
    expect(third!.id).not.toBe(first!.id);

    const listAfterForce = await history.list({
      projectId: project.id,
      path: 'sections/intro.tex',
    });
    expect(listAfterForce.length).toBe(2);
  });

  it('rejects path traversal attempts and invalid file references', async () => {
    await expect(
      history.create({
        projectId: project.id,
        path: '../outside.tex',
        content: 'Malicious content',
        trigger: 'save',
      }),
    ).rejects.toThrow();

    await expect(
      history.read({
        projectId: project.id,
        path: 'main.tex',
        snapshotId: 'invalid/id/with/slashes',
      }),
    ).rejects.toThrow();
  });

  it('pins and unpins snapshots with optional academic labels', async () => {
    const snapshot = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'Milestone draft.\n',
      trigger: 'save',
    });

    const pinned = await history.pin({
      projectId: project.id,
      path: 'main.tex',
      snapshotId: snapshot!.id,
      pinned: true,
      label: 'Pre-Submission Draft',
    });

    expect(pinned.pinned).toBe(true);
    expect(pinned.label).toBe('Pre-Submission Draft');

    const list = await history.list({ projectId: project.id, path: 'main.tex' });
    expect(list[0].pinned).toBe(true);
    expect(list[0].label).toBe('Pre-Submission Draft');

    const unpinned = await history.pin({
      projectId: project.id,
      path: 'main.tex',
      snapshotId: snapshot!.id,
      pinned: false,
      label: null,
    });
    expect(unpinned.pinned).toBe(false);
    expect(unpinned.label).toBeNull();
  });

  it('restores historical snapshots to disk and makes a pre-restore backup', async () => {
    const originalContent = 'Version 1 content.\n';
    const snapshot1 = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: originalContent,
      trigger: 'save',
    });

    // Save newer content to disk
    const v1 = await projects.readFile({ projectId: project.id, path: 'main.tex' });
    await projects.saveFile({
      projectId: project.id,
      path: 'main.tex',
      content: 'Version 2 with uncommitted work.\n',
      expectedRevision: v1.revision,
    });

    const v2 = await projects.readFile({ projectId: project.id, path: 'main.tex' });
    expect(v2.content).toBe('Version 2 with uncommitted work.\n');

    // Restore version 1
    const restored = await history.restore({
      projectId: project.id,
      path: 'main.tex',
      snapshotId: snapshot1!.id,
      expectedRevision: v2.revision,
    });

    expect(restored.content).toBe(originalContent);
    const diskContent = await readFile(join(root, 'main.tex'), 'utf8');
    expect(diskContent).toBe(originalContent);

    // Verify pre-restore backup snapshot exists
    const all = await history.list({ projectId: project.id, path: 'main.tex' });
    const preRestoreBackup = all.find((s) => s.label === 'Pre-restore backup');
    expect(preRestoreBackup).toBeDefined();
  });

  it('applies tiered pruning rules correctly (retaining pinned snapshots indefinitely)', async () => {
    const historyDir = join(root, '.textra', 'history');
    await mkdir(historyDir, { recursive: true });

    const now = new Date('2026-10-23T12:00:00Z').getTime();
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Helper to create synthetic snapshot on disk and in index
    const createSyntheticSnapshot = async (
      id: string,
      isoDate: string,
      pinned = false,
      label: string | null = null,
    ) => {
      const filename = `main.tex.${id}.gz`;
      const compressed = await gzipAsync(Buffer.from(`Content for ${id}`, 'utf8'));
      await writeFile(join(historyDir, filename), compressed);
      return {
        id,
        path: 'main.tex',
        createdAt: isoDate,
        sizeBytes: 20,
        revision: 'dummy-rev-' + id,
        trigger: 'save' as const,
        pinned,
        label,
      };
    };

    // 1. 10 days old (<=30 days) -> Keep
    const sRecent = await createSyntheticSnapshot(
      '2026-10-13T10-00-00.000Z',
      new Date(now - 10 * DAY_MS).toISOString(),
    );

    // 2. 50 days old (31-90 days): Two snapshots on the same day -> Keep only latest of that day
    const sDayEarly = await createSyntheticSnapshot(
      '2026-09-03T08-00-00.000Z',
      new Date(now - 50 * DAY_MS - 4 * 3600 * 1000).toISOString(),
    );
    const sDayLate = await createSyntheticSnapshot(
      '2026-09-03T16-00-00.000Z',
      new Date(now - 50 * DAY_MS + 4 * 3600 * 1000).toISOString(),
    );

    // 3. 150 days old (91-365 days): Two snapshots in the same week -> Keep only latest of that week
    const sWeekEarly = await createSyntheticSnapshot(
      '2026-05-20T10-00-00.000Z',
      new Date(now - 156 * DAY_MS).toISOString(),
    );
    const sWeekLate = await createSyntheticSnapshot(
      '2026-05-22T10-00-00.000Z',
      new Date(now - 154 * DAY_MS).toISOString(),
    );

    // 4. 400 days old (>365 days): Two snapshots in the same month -> Keep only latest of that month
    const sMonthEarly = await createSyntheticSnapshot(
      '2025-09-05T10-00-00.000Z',
      new Date(now - 413 * DAY_MS).toISOString(),
    );
    const sMonthLate = await createSyntheticSnapshot(
      '2025-09-25T10-00-00.000Z',
      new Date(now - 393 * DAY_MS).toISOString(),
    );

    // 5. 500 days old (>365 days) but PINNED -> Must NOT be pruned
    const sOldPinned = await createSyntheticSnapshot(
      '2025-06-10T10-00-00.000Z',
      new Date(now - 500 * DAY_MS).toISOString(),
      true,
      'Old Pinned Draft',
    );

    const indexData = {
      version: 1,
      snapshots: [
        sRecent,
        sDayEarly,
        sDayLate,
        sWeekEarly,
        sWeekLate,
        sMonthEarly,
        sMonthLate,
        sOldPinned,
      ],
    };

    await writeFile(join(historyDir, 'index.json'), JSON.stringify(indexData, null, 2), 'utf8');

    // Run pruning using the reference 'now'
    const prunedCount = await history.prune(project.id, now);

    // Expected pruned: sDayEarly, sWeekEarly, sMonthEarly = 3 pruned
    expect(prunedCount).toBe(3);

    const remaining = await history.list({ projectId: project.id, path: 'main.tex' });
    const remainingIds = new Set(remaining.map((s) => s.id));

    expect(remainingIds.has(sRecent.id)).toBe(true);
    expect(remainingIds.has(sDayLate.id)).toBe(true);
    expect(remainingIds.has(sDayEarly.id)).toBe(false);
    expect(remainingIds.has(sWeekLate.id)).toBe(true);
    expect(remainingIds.has(sWeekEarly.id)).toBe(false);
    expect(remainingIds.has(sMonthLate.id)).toBe(true);
    expect(remainingIds.has(sMonthEarly.id)).toBe(false);
    expect(remainingIds.has(sOldPinned.id)).toBe(true);
  });
});
