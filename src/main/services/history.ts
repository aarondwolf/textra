import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import type {
  CreateHistorySnapshotRequest,
  FileRef,
  FileSnapshot,
  HistorySnapshotContent,
  HistorySnapshotRef,
  HistorySnapshotSummary,
  PinHistorySnapshotRequest,
  RestoreHistorySnapshotRequest,
} from '../../shared/api';
import { ProjectError, type ProjectService, validateRelativePath } from './projects';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

interface HistoryIndexFile {
  version: 1;
  snapshots: HistorySnapshotSummary[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProjectError('INVALID_ARGUMENT', 'Invalid request.');
  return value as Record<string, unknown>;
}

function missing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}

function sha256(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
}

function getIsoWeek(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.getTime();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.getTime()) / (7 * DAY_MS));
  return `${target.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

export class HistoryService {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly projects: ProjectService) {}

  async flush(): Promise<void> {
    await this.pending.catch(() => undefined);
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.catch(() => undefined).then(action);
    this.pending = result;
    return result;
  }

  private historyDirectory(root: string): string {
    return join(root, '.textra', 'history');
  }

  private indexFilePath(root: string): string {
    return join(this.historyDirectory(root), 'index.json');
  }

  private snapshotDirAndFilename(
    historyRoot: string,
    relativePath: string,
    id: string,
  ): { dir: string; filename: string; filePath: string } {
    const parts = relativePath.split('/');
    const relDir = parts.slice(0, -1);
    const fileName = parts.at(-1)!;
    const dir = relDir.length ? join(historyRoot, ...relDir) : historyRoot;
    const filename = `${fileName}.${id}.gz`;
    return { dir, filename, filePath: join(dir, filename) };
  }

  private async loadIndex(root: string): Promise<HistoryIndexFile> {
    const indexPath = this.indexFilePath(root);
    try {
      const raw = await readFile(indexPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'version' in parsed &&
        parsed.version === 1 &&
        Array.isArray((parsed as HistoryIndexFile).snapshots)
      ) {
        return parsed as HistoryIndexFile;
      }
    } catch (error) {
      if (!missing(error)) {
        // If index is corrupt, fallback gracefully to empty
      }
    }
    return { version: 1, snapshots: [] };
  }

  private async saveIndex(root: string, index: HistoryIndexFile): Promise<void> {
    const historyDir = this.historyDirectory(root);
    await mkdir(historyDir, { recursive: true });
    const indexPath = this.indexFilePath(root);
    const tempPath = join(historyDir, `.index-${randomUUID()}.tmp`);
    const serialized = JSON.stringify(index, null, 2) + '\n';
    try {
      const file = await open(tempPath, 'wx', 0o600);
      try {
        await file.writeFile(serialized, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(tempPath, indexPath);
    } finally {
      await unlink(tempPath).catch((err: unknown) => {
        if (!missing(err)) throw err;
      });
    }
  }

  async list(value: FileRef): Promise<HistorySnapshotSummary[]> {
    return this.serialize(async () => {
      const request = record(value);
      if (typeof request.projectId !== 'string')
        throw new ProjectError('INVALID_ARGUMENT', 'Invalid project identifier.');
      const path = validateRelativePath(request.path);
      const root = this.projects.getRoot(request.projectId);
      const index = await this.loadIndex(root);
      return index.snapshots
        .filter((s) => s.path === path)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }

  async read(value: HistorySnapshotRef): Promise<HistorySnapshotContent> {
    return this.serialize(async () => {
      const request = record(value);
      if (typeof request.projectId !== 'string')
        throw new ProjectError('INVALID_ARGUMENT', 'Invalid project identifier.');
      if (typeof request.snapshotId !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(request.snapshotId))
        throw new ProjectError('INVALID_ARGUMENT', 'Invalid snapshot identifier.');
      const path = validateRelativePath(request.path);
      const root = this.projects.getRoot(request.projectId);
      const index = await this.loadIndex(root);
      const summary = index.snapshots.find((s) => s.path === path && s.id === request.snapshotId);
      if (!summary) {
        throw new ProjectError('NOT_FOUND', 'Historical snapshot not found.');
      }
      const historyRoot = this.historyDirectory(root);
      const { filePath } = this.snapshotDirAndFilename(historyRoot, path, summary.id);
      let compressedBytes: Buffer;
      try {
        compressedBytes = await readFile(filePath);
      } catch (error) {
        if (missing(error))
          throw new ProjectError('NOT_FOUND', 'Historical snapshot file missing.');
        throw error;
      }
      let decompressed: Buffer;
      try {
        decompressed = await gunzipAsync(compressedBytes, { maxOutputLength: MAX_TEXT_BYTES });
      } catch {
        throw new ProjectError('INVALID_ENCODING', 'Could not decompress historical snapshot.');
      }
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(decompressed);
      } catch {
        throw new ProjectError('INVALID_ENCODING', 'Historical snapshot is not valid UTF-8 text.');
      }
      return { ...summary, content };
    });
  }

  async create(value: CreateHistorySnapshotRequest): Promise<HistorySnapshotSummary | null> {
    return this.serialize(async () => {
      const request = record(value);
      if (typeof request.projectId !== 'string')
        throw new ProjectError('INVALID_ARGUMENT', 'Invalid project identifier.');
      if (typeof request.content !== 'string')
        throw new ProjectError('INVALID_ARGUMENT', 'Content must be text.');
      const path = validateRelativePath(request.path);
      const content = request.content;
      const trigger = request.trigger as CreateHistorySnapshotRequest['trigger'];
      const force = Boolean(request.force);
      const label =
        typeof request.label === 'string' && request.label.trim() ? request.label.trim() : null;

      if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES)
        throw new ProjectError('FILE_TOO_LARGE', 'Text files must be smaller than 5 MiB.');

      const root = this.projects.getRoot(request.projectId);
      const revision = sha256(content);
      const index = await this.loadIndex(root);

      // Check the latest snapshot for this file
      const existing = index.snapshots
        .filter((s) => s.path === path)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = existing[0];

      if (!force && latest && latest.revision === revision) {
        // Redundant snapshot with identical content: skip writing
        return latest;
      }

      const now = new Date();
      const id = now.toISOString().replace(/:/g, '-');
      const createdAt = now.toISOString();
      const historyRoot = this.historyDirectory(root);
      const { dir, filePath } = this.snapshotDirAndFilename(historyRoot, path, id);

      await mkdir(dir, { recursive: true });

      const compressed = await gzipAsync(Buffer.from(content, 'utf8'), { level: 9 });
      const tempPath = join(dir, `.snap-${randomUUID()}.tmp`);

      try {
        const file = await open(tempPath, 'wx', 0o600);
        try {
          await file.writeFile(compressed);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(tempPath, filePath);
      } finally {
        await unlink(tempPath).catch((err: unknown) => {
          if (!missing(err)) throw err;
        });
      }

      const summary: HistorySnapshotSummary = {
        id,
        path,
        createdAt,
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        revision,
        trigger,
        pinned: Boolean(label),
        label,
      };

      index.snapshots.push(summary);
      await this.saveIndex(root, index);
      return summary;
    });
  }

  async createFromDisk(value: {
    projectId: string;
    path: string;
    trigger: CreateHistorySnapshotRequest['trigger'];
    force?: boolean;
    label?: string;
  }): Promise<HistorySnapshotSummary | null> {
    try {
      const snapshot = await this.projects.readFile({
        projectId: value.projectId,
        path: value.path,
      });
      return await this.create({
        projectId: value.projectId,
        path: value.path,
        content: snapshot.content,
        trigger: value.trigger,
        force: value.force,
        label: value.label,
      });
    } catch {
      return null;
    }
  }

  async pin(value: PinHistorySnapshotRequest): Promise<HistorySnapshotSummary> {
    return this.serialize(async () => {
      const request = record(value);
      if (typeof request.projectId !== 'string')
        throw new ProjectError('INVALID_ARGUMENT', 'Invalid project identifier.');
      if (typeof request.snapshotId !== 'string')
        throw new ProjectError('INVALID_ARGUMENT', 'Invalid snapshot identifier.');
      if (typeof request.pinned !== 'boolean')
        throw new ProjectError('INVALID_ARGUMENT', 'Pinned must be a boolean.');
      const path = validateRelativePath(request.path);
      const label =
        typeof request.label === 'string' && request.label.trim() ? request.label.trim() : null;

      const root = this.projects.getRoot(request.projectId);
      const index = await this.loadIndex(root);
      const snapshot = index.snapshots.find((s) => s.path === path && s.id === request.snapshotId);
      if (!snapshot) throw new ProjectError('NOT_FOUND', 'Historical snapshot not found.');

      snapshot.pinned = request.pinned || Boolean(label);
      snapshot.label = label;

      await this.saveIndex(root, index);
      return snapshot;
    });
  }

  async restore(value: RestoreHistorySnapshotRequest): Promise<FileSnapshot> {
    const historical = await this.read({
      projectId: value.projectId,
      path: value.path,
      snapshotId: value.snapshotId,
    });

    // Create a backup snapshot of current disk content before overwriting
    await this.createFromDisk({
      projectId: value.projectId,
      path: value.path,
      trigger: 'manual',
      force: true,
      label: 'Pre-restore backup',
    }).catch(() => undefined);

    // Save historical content over the current file with revision checking
    const saved = await this.projects.saveFile({
      projectId: value.projectId,
      path: value.path,
      content: historical.content,
      expectedRevision: value.expectedRevision,
    });

    return saved;
  }

  async exportSnapshot(value: HistorySnapshotRef, window: BrowserWindow): Promise<boolean> {
    const historical = await this.read(value);
    const fileName = basename(value.path);
    const result = await dialog.showSaveDialog(window, {
      title: 'Export file snapshot',
      defaultPath: `${fileName}.${historical.id}.tex`,
    });
    if (result.canceled || !result.filePath) return false;
    const dest = result.filePath;
    const temp = join(dirname(dest), `.export-${randomUUID()}.tmp`);
    try {
      const file = await open(temp, 'wx', 0o600);
      try {
        await file.writeFile(historical.content, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, dest);
    } finally {
      await unlink(temp).catch((err: unknown) => {
        if (!missing(err)) throw err;
      });
    }
    return true;
  }

  async prune(projectId: string, nowMs = Date.now()): Promise<number> {
    return this.serialize(async () => {
      const root = this.projects.getRoot(projectId);
      const index = await this.loadIndex(root);
      const historyRoot = this.historyDirectory(root);

      // Group unpinned, unlabeled snapshots by file path
      const byFile = new Map<string, HistorySnapshotSummary[]>();
      const toKeep = new Set<string>();

      for (const snapshot of index.snapshots) {
        if (snapshot.pinned || snapshot.label) {
          toKeep.add(snapshot.id);
          continue;
        }
        let list = byFile.get(snapshot.path);
        if (!list) {
          list = [];
          byFile.set(snapshot.path, list);
        }
        list.push(snapshot);
      }

      const toPrune: HistorySnapshotSummary[] = [];

      for (const [, snapshots] of byFile) {
        snapshots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        // Grouping buckets for tiered retention
        const dailyLatest = new Map<string, HistorySnapshotSummary>();
        const weeklyLatest = new Map<string, HistorySnapshotSummary>();
        const monthlyLatest = new Map<string, HistorySnapshotSummary>();

        for (const snap of snapshots) {
          const snapTime = new Date(snap.createdAt).getTime();
          const ageDays = (nowMs - snapTime) / DAY_MS;

          if (ageDays <= 30) {
            // Keep all within 30 days
            toKeep.add(snap.id);
          } else if (ageDays <= 90) {
            // 31–90 days: 1 per day (keep latest of that day)
            const dayKey = snap.createdAt.slice(0, 10);
            dailyLatest.set(dayKey, snap);
          } else if (ageDays <= 365) {
            // 91–365 days: 1 per week (keep latest of that week)
            const weekKey = getIsoWeek(new Date(snap.createdAt));
            weeklyLatest.set(weekKey, snap);
          } else {
            // > 365 days: 1 per month (keep latest of that month)
            const monthKey = snap.createdAt.slice(0, 7);
            monthlyLatest.set(monthKey, snap);
          }
        }

        for (const snap of dailyLatest.values()) toKeep.add(snap.id);
        for (const snap of weeklyLatest.values()) toKeep.add(snap.id);
        for (const snap of monthlyLatest.values()) toKeep.add(snap.id);

        for (const snap of snapshots) {
          if (!toKeep.has(snap.id)) {
            toPrune.push(snap);
          }
        }
      }

      if (toPrune.length === 0) return 0;

      // Unlink pruned snapshot files
      for (const snap of toPrune) {
        const { filePath } = this.snapshotDirAndFilename(historyRoot, snap.path, snap.id);
        await unlink(filePath).catch((err: unknown) => {
          if (!missing(err)) throw err;
        });
      }

      index.snapshots = index.snapshots.filter((s) => toKeep.has(s.id));
      await this.saveIndex(root, index);
      return toPrune.length;
    });
  }
}
