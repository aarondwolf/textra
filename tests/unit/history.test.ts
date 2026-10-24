import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryService } from '../../src/main/services/history';
import { ProjectService } from '../../src/main/services/projects';
import type { ProjectInfo } from '../../src/shared/api';
import { HistoryStorage } from '../../src/main/services/history-storage';

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
    history = new HistoryService(projects, join(directory, 'user-data'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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

    const { snapshots: list } = await history.list({
      projectId: project.id,
      path: 'sections/intro.tex',
    });
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

    const { snapshots: listAfterForce } = await history.list({
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

    const { snapshots: list } = await history.list({ projectId: project.id, path: 'main.tex' });
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
      recoveryBuffer: v2.content,
    });

    expect(restored.content).toBe(originalContent);
    const diskContent = await readFile(join(root, 'main.tex'), 'utf8');
    expect(diskContent).toBe(originalContent);

    // Verify pre-restore backup snapshot exists
    const { snapshots: all } = await history.list({ projectId: project.id, path: 'main.tex' });
    const preRestoreBackup = all.find((s) => s.label === 'Pre-restore editor backup');
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
        sizeBytes: Buffer.byteLength(`Content for ${id}`, 'utf8'),
        revision: createHash('sha256').update(`Content for ${id}`).digest('hex'),
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

    const { snapshots: remaining } = await history.list({
      projectId: project.id,
      path: 'main.tex',
    });
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

  it('deletes a historical snapshot and removes its compressed file from disk', async () => {
    const snap = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'Snapshot to delete.\n',
      trigger: 'manual',
    });
    expect(snap).not.toBeNull();

    const historyDir = join(root, '.textra', 'history');
    let files = await readdir(historyDir);
    const gz = files.find((f) => f.includes(snap!.id));
    expect(gz).toBeDefined();

    await history.deleteSnapshot({
      projectId: project.id,
      path: 'main.tex',
      snapshotId: snap!.id,
    });

    files = await readdir(historyDir);
    expect(files.find((f) => f.includes(snap!.id))).toBeUndefined();

    const { snapshots: list } = await history.list({ projectId: project.id, path: 'main.tex' });
    expect(list.find((s) => s.id === snap!.id)).toBeUndefined();
  });

  it('thins intermediate save snapshots older than 30 minutes in the same 10-minute window', async () => {
    const historyDir = join(root, '.textra', 'history');
    await mkdir(historyDir, { recursive: true });

    const now = new Date('2026-10-23T12:00:00.000Z').getTime();
    const createSnap = async (
      id: string,
      createdAtIso: string,
      trigger: 'save' | 'manual' = 'save',
    ) => {
      const fileName = `main.tex.${id}.gz`;
      const compressed = await gzipAsync(Buffer.from(`Content for ${id}`, 'utf8'));
      await writeFile(join(historyDir, fileName), compressed);
      return {
        id,
        path: 'main.tex',
        createdAt: createdAtIso,
        trigger,
        pinned: false,
        label: null,
        sizeBytes: Buffer.byteLength(`Content for ${id}`, 'utf8'),
        revision: createHash('sha256').update(`Content for ${id}`).digest('hex'),
      };
    };

    // Save 1: 10 minutes ago (within 30m grace period) -> KEEP
    const saveRecent1 = await createSnap('save-rec1', new Date(now - 10 * 60 * 1000).toISOString());
    // Save 2: 12 minutes ago (within 30m grace period) -> KEEP
    const saveRecent2 = await createSnap('save-rec2', new Date(now - 12 * 60 * 1000).toISOString());

    // Save 3 & 4: 45m and 48m ago (same 10-minute bucket: ~11:10-11:20) -> keep latest (Save 3 at 45m), prune Save 4
    const saveOldEarly = await createSnap(
      'save-old-early',
      new Date(now - 48 * 60 * 1000).toISOString(),
    );
    const saveOldLate = await createSnap(
      'save-old-late',
      new Date(now - 45 * 60 * 1000).toISOString(),
    );

    // Non-save (manual): 50m ago -> KEEP
    const manualOld = await createSnap(
      'manual-old',
      new Date(now - 50 * 60 * 1000).toISOString(),
      'manual',
    );

    const indexData = {
      version: 1,
      snapshots: [saveRecent1, saveRecent2, saveOldEarly, saveOldLate, manualOld],
    };
    await writeFile(join(historyDir, 'index.json'), JSON.stringify(indexData, null, 2), 'utf8');

    const prunedCount = await history.prune(project.id, now);
    expect(prunedCount).toBe(1);

    const { snapshots: remaining } = await history.list({
      projectId: project.id,
      path: 'main.tex',
    });
    const remainingIds = new Set(remaining.map((s) => s.id));
    expect(remainingIds.has('save-rec1')).toBe(true);
    expect(remainingIds.has('save-rec2')).toBe(true);
    expect(remainingIds.has('save-old-late')).toBe(true);
    expect(remainingIds.has('save-old-early')).toBe(false);
    expect(remainingIds.has('manual-old')).toBe(true);
  });

  it('keeps production history portable and available after the project session changes', async () => {
    const customUserData = join(directory, 'custom-user-data');
    const isolatedHistory = new HistoryService(projects, customUserData);

    const content = 'Test content in userDataDir.\n';
    const snapshot = await isolatedHistory.create({
      projectId: project.id,
      path: 'main.tex',
      content,
      trigger: 'save',
    });

    expect(snapshot).not.toBeNull();
    const files = await readdir(join(root, '.textra', 'history'));
    expect(files).toContain('index.json');

    const reopened = await projects.openRoot(root);
    expect(reopened.id).not.toBe(project.id);
    const readBack = await isolatedHistory.read({
      projectId: reopened.id,
      path: 'main.tex',
      snapshotId: snapshot!.id,
    });
    expect(readBack.content).toBe(content);
    await isolatedHistory.flush();
  });

  it.each(['{not json', '{"version":2,"snapshots":[]}'])(
    'preserves corrupt or future catalogs: %s',
    async (catalog) => {
      const indexPath = join(root, '.textra', 'history', 'index.json');
      await mkdir(join(root, '.textra', 'history'), { recursive: true });
      await writeFile(indexPath, catalog);
      await expect(history.list({ projectId: project.id, path: 'main.tex' })).rejects.toMatchObject(
        { code: 'INVALID_HISTORY' },
      );
      await expect(
        history.create({
          projectId: project.id,
          path: 'main.tex',
          content: 'new',
          trigger: 'save',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_HISTORY' });
      expect(await readFile(indexPath, 'utf8')).toBe(catalog);
    },
  );

  it.each([
    { path: '../../../outside/victim' },
    { id: '../../victim' },
    { revision: 'not-a-hash' },
    { createdAt: 'not-a-date' },
    { sizeBytes: -1 },
    { pinned: 'yes' },
    { trigger: 'shell' },
    { extra: 'unknown-field' },
  ])('rejects untrusted persisted snapshot records before pruning: %j', async (change) => {
    const valid = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'original',
      trigger: 'save',
    });
    const indexPath = join(root, '.textra', 'history', 'index.json');
    const malicious = JSON.stringify({ version: 1, snapshots: [{ ...valid, ...change }] });
    await writeFile(indexPath, malicious);
    const before = await readdir(join(root, '.textra', 'history'));
    await expect(history.prune(project.id)).rejects.toMatchObject({ code: 'INVALID_HISTORY' });
    expect(await readFile(indexPath, 'utf8')).toBe(malicious);
    expect(await readdir(join(root, '.textra', 'history'))).toEqual(before);
  });

  it('bounds index reads without replacing oversized data', async () => {
    const indexPath = join(root, '.textra', 'history', 'index.json');
    await mkdir(join(root, '.textra', 'history'), { recursive: true });
    await writeFile(indexPath, Buffer.alloc(16 * 1024 * 1024 + 1, 32));
    await expect(history.list({ projectId: project.id, path: 'main.tex' })).rejects.toMatchObject({
      code: 'HISTORY_LIMIT',
    });
    expect((await stat(indexPath)).size).toBe(16 * 1024 * 1024 + 1);
  });

  it.each(['settings-parent', 'history-directory', 'snapshot-parent'])(
    'rejects linked storage directories: %s',
    async (location) => {
      const outside = join(directory, 'outside');
      await mkdir(outside);
      const destination =
        location === 'settings-parent'
          ? join(root, '.textra')
          : location === 'history-directory'
            ? join(root, '.textra', 'history')
            : join(root, '.textra', 'history', 'sections');
      await mkdir(dirname(destination), { recursive: true });
      await symlink(outside, destination, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(
        history.create({
          projectId: project.id,
          path: 'sections/intro.tex',
          content: 'do not escape',
          trigger: 'save',
        }),
      ).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
      expect(await readdir(outside)).toEqual([]);
    },
  );

  it('rejects hard-linked indexes and snapshots without changing the external link', async () => {
    const snapshot = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'safe content',
      trigger: 'save',
    });
    const historyDir = join(root, '.textra', 'history');
    const snapshotFile = join(historyDir, `main.tex.${snapshot.id}.gz`);
    const externalSnapshot = join(directory, 'external.gz');
    await link(snapshotFile, externalSnapshot);
    const originalSnapshot = await readFile(externalSnapshot);
    await expect(
      history.read({ projectId: project.id, path: 'main.tex', snapshotId: snapshot.id }),
    ).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(
      history.deleteSnapshot({ projectId: project.id, path: 'main.tex', snapshotId: snapshot.id }),
    ).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await readFile(externalSnapshot)).toEqual(originalSnapshot);
    const indexPath = join(historyDir, 'index.json');
    const externalIndex = join(directory, 'external-index.json');
    await link(indexPath, externalIndex);
    const originalIndex = await readFile(externalIndex);
    await expect(
      history.create({ projectId: project.id, path: 'main.tex', content: 'new', trigger: 'save' }),
    ).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await readFile(externalIndex)).toEqual(originalIndex);
  });

  it('returns bounded pages without duplicating snapshots across cursors', async () => {
    const snapshot = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'page fixture',
      trigger: 'save',
    });
    const snapshots = Array.from({ length: 251 }, (_, index) => ({
      ...snapshot,
      id: `snapshot-${String(index).padStart(3, '0')}`,
    }));
    await writeFile(
      join(root, '.textra', 'history', 'index.json'),
      JSON.stringify({ version: 1, snapshots }),
    );
    const first = await history.list({ projectId: project.id, path: 'main.tex' });
    expect(first.snapshots).toHaveLength(100);
    const second = await history.list({
      projectId: project.id,
      path: 'main.tex',
      cursor: first.nextCursor!,
      limit: 200,
    });
    expect(second.snapshots).toHaveLength(151);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.snapshots, ...second.snapshots].map((s) => s.id)).size).toBe(251);
    await expect(
      history.list({ projectId: project.id, path: 'main.tex', limit: 201 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(
      history.list({ projectId: project.id, path: 'main.tex', cursor: 'missing-cursor' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('backs up the exact dirty editor buffer and differing disk text before restoring', async () => {
    const historical = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'historical',
      trigger: 'manual',
    });
    const disk = await projects.readFile({ projectId: project.id, path: 'main.tex' });
    await history.restore({
      projectId: project.id,
      path: 'main.tex',
      snapshotId: historical.id,
      expectedRevision: disk.revision,
      recoveryBuffer: 'unsaved editor text α\n',
    });
    const { snapshots } = await history.list({ projectId: project.id, path: 'main.tex' });
    for (const [backupLabel, content] of [
      ['Pre-restore editor backup', 'unsaved editor text α\n'],
      ['Pre-restore disk backup', disk.content],
    ]) {
      const backup = snapshots.find((s) => s.label === backupLabel)!;
      expect(backup).toBeDefined();
      expect(
        (await history.read({ projectId: project.id, path: 'main.tex', snapshotId: backup.id }))
          .content,
      ).toBe(content);
    }
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe('historical');
  });

  it('aborts restoration when publishing the recovery backup fails', async () => {
    const historical = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'historical',
      trigger: 'manual',
    });
    const disk = await projects.readFile({ projectId: project.id, path: 'main.tex' });
    const original = HistoryStorage.prototype.write;
    vi.spyOn(HistoryStorage.prototype, 'write').mockImplementation(async function (
      this: HistoryStorage,
      ...args
    ) {
      if (args[0].at(-1) === 'index.json') throw new Error('backup index unavailable');
      return original.apply(this, args);
    });
    await expect(
      history.restore({
        projectId: project.id,
        path: 'main.tex',
        snapshotId: historical.id,
        expectedRevision: disk.revision,
        recoveryBuffer: 'dirty editor',
      }),
    ).rejects.toThrow('backup index unavailable');
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toBe(disk.content);
  });

  it('keeps all compressed snapshots when prune index publication fails', async () => {
    const early = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'early',
      trigger: 'save',
    });
    const late = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'late',
      trigger: 'save',
    });
    const indexPath = join(root, '.textra', 'history', 'index.json');
    const catalog = JSON.stringify({
      version: 1,
      snapshots: [
        { ...early, createdAt: '2026-08-01T01:00:00.000Z' },
        { ...late, createdAt: '2026-08-01T02:00:00.000Z' },
      ],
    });
    await writeFile(indexPath, catalog);
    const before = await readdir(join(root, '.textra', 'history'));
    vi.spyOn(HistoryStorage.prototype, 'write').mockRejectedValue(
      new Error('cannot publish prune'),
    );
    await expect(history.prune(project.id, Date.parse('2026-10-01T00:00:00.000Z'))).rejects.toThrow(
      'cannot publish prune',
    );
    expect(await readdir(join(root, '.textra', 'history'))).toEqual(before);
    expect(await readFile(indexPath, 'utf8')).toBe(catalog);
  });

  it('preserves a concurrent external index edit rather than publishing a stale catalog', async () => {
    const snapshot = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'original',
      trigger: 'save',
    });
    const indexPath = join(root, '.textra', 'history', 'index.json');
    const external = JSON.stringify({
      version: 1,
      snapshots: [{ ...snapshot, pinned: true, label: 'External edit' }],
    });
    const original = HistoryStorage.prototype.write;
    vi.spyOn(HistoryStorage.prototype, 'write').mockImplementation(async function (
      this: HistoryStorage,
      ...args
    ) {
      if (args[0].at(-1) === 'index.json') await writeFile(indexPath, external);
      return original.apply(this, args);
    });
    await expect(
      history.create({ projectId: project.id, path: 'main.tex', content: 'new', trigger: 'save' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(indexPath, 'utf8')).toBe(external);
  });

  it('rejects modified snapshot bytes and bounded decompression bombs', async () => {
    const snapshot = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'original',
      trigger: 'save',
    });
    const path = join(root, '.textra', 'history', `main.tex.${snapshot.id}.gz`);
    await writeFile(path, await gzipAsync(Buffer.from('tampered')));
    await expect(
      history.read({ projectId: project.id, path: 'main.tex', snapshotId: snapshot.id }),
    ).rejects.toMatchObject({ code: 'INVALID_HISTORY' });
    await writeFile(path, await gzipAsync(Buffer.alloc(5 * 1024 * 1024 + 1, 65)));
    await expect(
      history.read({ projectId: project.id, path: 'main.tex', snapshotId: snapshot.id }),
    ).rejects.toMatchObject({ code: 'INVALID_HISTORY' });
  });

  it('explicitly imports a selected legacy UUID store and preserves the original bytes', async () => {
    const snapshot = await history.create({
      projectId: project.id,
      path: 'main.tex',
      content: 'legacy content',
      trigger: 'manual',
      label: 'recovered milestone',
    });
    const oldHistory = join(root, '.textra', 'history');
    const id = randomUUID();
    const legacyDir = join(directory, 'user-data', 'history', id);
    await mkdir(legacyDir, { recursive: true });
    for (const name of await readdir(oldHistory))
      await copyFile(join(oldHistory, name), join(legacyDir, name));
    const originals = await Promise.all(
      (await readdir(legacyDir)).map(async (name) => ({
        name,
        bytes: await readFile(join(legacyDir, name)),
      })),
    );
    // This is a disposable fixture directory under the test workspace.
    await rm(oldHistory, { recursive: true, maxRetries: 5, retryDelay: 100 });
    expect((await history.list({ projectId: project.id, path: 'main.tex' })).snapshots).toEqual([]);
    const candidates = await history.listLegacy(project.id);
    expect(candidates).toEqual([
      { id, snapshotCount: 1, latestCreatedAt: snapshot.createdAt, samplePaths: ['main.tex'] },
    ]);
    await expect(
      history.importLegacy({ projectId: project.id, legacyId: '../outside' }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const originalWrite = HistoryStorage.prototype.write;
    const publication = vi
      .spyOn(HistoryStorage.prototype, 'write')
      .mockImplementation(async function (this: HistoryStorage, ...args) {
        if (args[0].at(-1) === 'index.json') throw new Error('interrupted import');
        return originalWrite.apply(this, args);
      });
    await expect(history.importLegacy({ projectId: project.id, legacyId: id })).rejects.toThrow(
      'interrupted import',
    );
    publication.mockRestore();
    expect(await history.importLegacy({ projectId: project.id, legacyId: id })).toBe(1);
    expect(await history.importLegacy({ projectId: project.id, legacyId: id })).toBe(0);
    expect(
      (await history.read({ projectId: project.id, path: 'main.tex', snapshotId: snapshot.id }))
        .content,
    ).toBe('legacy content');
    for (const original of originals)
      expect(await readFile(join(legacyDir, original.name))).toEqual(original.bytes);
  });
});
