import { AsyncMutex } from './mutex';
import { createHash, randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import type {
  CreateHistorySnapshotRequest,
  FileSnapshot,
  HistorySnapshotContent,
  HistorySnapshotRef,
  HistorySnapshotSummary,
  HistorySnapshotPage,
  ListFileHistoryRequest,
  LegacyHistorySummary,
  PinHistorySnapshotRequest,
  RestoreHistorySnapshotRequest,
} from '../../shared/api';
import { HistoryStorage, isMissing } from './history-storage';
import { ProjectError, type ProjectService, validateRelativePath } from './projects';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = MAX_TEXT_BYTES + 64 * 1024;
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_SNAPSHOTS = 20000;
const DAY_MS = 24 * 60 * 60 * 1000;
const localParts = ['.textra', 'history'];
const snapshotId = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const legacyId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const triggers = new Set(['save', 'interval', 'compile', 'ai', 'format', 'manual']);
interface HistoryIndexFile {
  version: 1;
  snapshots: HistorySnapshotSummary[];
}
interface IndexState {
  index: HistoryIndexFile;
  bytes: Buffer | null;
}
interface Scope {
  storage: HistoryStorage;
  parts: string[];
  projectId: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ProjectError('INVALID_ARGUMENT', 'Invalid history request.');
  return value as Record<string, unknown>;
}
function invalid(): never {
  throw new ProjectError(
    'INVALID_HISTORY',
    'File history is invalid or uses an unsupported version. Existing history was preserved.',
  );
}
function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
function text(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_TEXT_BYTES ||
    value.includes('\0') ||
    Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES
  )
    throw new ProjectError('INVALID_ARGUMENT', 'History requires UTF-8 text smaller than 5 MiB.');
  if (new TextDecoder('utf-8', { ignoreBOM: true }).decode(Buffer.from(value, 'utf8')) !== value)
    throw new ProjectError('INVALID_ENCODING', 'History text contains invalid Unicode.');
  return value;
}
function label(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 256)
    throw new ProjectError(
      'INVALID_ARGUMENT',
      'A history label must contain at most 256 characters.',
    );
  return value.trim() || null;
}
function parseIndex(bytes: Buffer): HistoryIndexFile {
  try {
    const parsed = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (
      Object.keys(parsed).length !== 2 ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.snapshots) ||
      parsed.snapshots.length > MAX_SNAPSHOTS
    )
      invalid();
    const seen = new Set<string>();
    const snapshots = parsed.snapshots.map((value: unknown): HistorySnapshotSummary => {
      const s = record(value);
      const fields = [
        'id',
        'path',
        'createdAt',
        'sizeBytes',
        'revision',
        'trigger',
        'pinned',
        'label',
      ];
      if (
        Object.keys(s).length !== fields.length ||
        fields.some((key) => !Object.hasOwn(s, key)) ||
        typeof s.id !== 'string' ||
        !snapshotId.test(s.id) ||
        typeof s.createdAt !== 'string' ||
        s.createdAt.length !== 24 ||
        !Number.isFinite(Date.parse(s.createdAt)) ||
        new Date(s.createdAt).toISOString() !== s.createdAt ||
        typeof s.sizeBytes !== 'number' ||
        !Number.isSafeInteger(s.sizeBytes) ||
        s.sizeBytes < 0 ||
        s.sizeBytes > MAX_TEXT_BYTES ||
        typeof s.revision !== 'string' ||
        !/^[a-f0-9]{64}$/.test(s.revision) ||
        typeof s.trigger !== 'string' ||
        !triggers.has(s.trigger) ||
        typeof s.pinned !== 'boolean' ||
        (s.label !== null &&
          (typeof s.label !== 'string' ||
            !s.label ||
            s.label.length > 256 ||
            s.label.trim() !== s.label))
      )
        invalid();
      const path = validateRelativePath(s.path);
      const key =
        process.platform === 'win32' ? `${path}\0${s.id}`.toLowerCase() : `${path}\0${s.id}`;
      if (seen.has(key)) invalid();
      seen.add(key);
      return {
        id: s.id,
        path,
        createdAt: s.createdAt,
        sizeBytes: s.sizeBytes,
        revision: s.revision,
        trigger: s.trigger as HistorySnapshotSummary['trigger'],
        pinned: s.pinned,
        label: s.label as string | null,
      };
    });
    return { version: 1, snapshots };
  } catch {
    return invalid();
  }
}
function fileParts(scope: Scope, path: string, id: string): string[] {
  validateRelativePath(path);
  if (!snapshotId.test(id)) invalid();
  const parts = path.split('/');
  return [...scope.parts, ...parts.slice(0, -1), `${parts.at(-1)!}.${id}.gz`];
}
function getIsoWeek(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  target.setUTCDate(target.getUTCDate() - ((target.getUTCDay() + 6) % 7) + 3);
  const firstThursday = target.getTime();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  return `${target.getUTCFullYear()}-W${String(1 + Math.ceil((firstThursday - target.getTime()) / (7 * DAY_MS))).padStart(2, '0')}`;
}

export class HistoryService {
  private readonly mutex = new AsyncMutex();
  constructor(
    private readonly projects: ProjectService,
    private readonly userDataDir?: string,
  ) {}
  async flush(): Promise<void> {
    await this.mutex.flush();
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    return this.mutex.run(action);
  }
  private scope(projectId: string): Scope {
    return {
      storage: new HistoryStorage(this.projects.getRoot(projectId)),
      parts: localParts,
      projectId,
    };
  }
  private assertCurrent(scope: Scope): void {
    this.projects.getRoot(scope.projectId);
  }
  private async load(scope: Scope): Promise<IndexState> {
    const bytes = await scope.storage.read([...scope.parts, 'index.json'], MAX_INDEX_BYTES);
    this.assertCurrent(scope);
    return { index: bytes === null ? { version: 1, snapshots: [] } : parseIndex(bytes), bytes };
  }
  private async save(
    scope: Scope,
    index: HistoryIndexFile,
    expected: Buffer | null,
  ): Promise<void> {
    this.assertCurrent(scope);
    const bytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
    if (bytes.length > MAX_INDEX_BYTES || index.snapshots.length > MAX_SNAPSHOTS)
      throw new ProjectError(
        'HISTORY_LIMIT',
        'File history has reached its storage limit. Existing snapshots were preserved.',
      );
    parseIndex(bytes);
    await scope.storage.write([...scope.parts, 'index.json'], bytes, expected, MAX_INDEX_BYTES);
  }
  list(value: ListFileHistoryRequest): Promise<HistorySnapshotPage> {
    return this.serialize(async () => {
      const request = record(value);
      if (typeof request.projectId !== 'string')
        throw new ProjectError('INVALID_ARGUMENT', 'Invalid project identifier.');
      const path = validateRelativePath(request.path);
      const limit = request.limit === undefined ? 100 : request.limit;
      if (
        typeof limit !== 'number' ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 200 ||
        (request.cursor !== undefined &&
          (typeof request.cursor !== 'string' || !snapshotId.test(request.cursor)))
      )
        throw new ProjectError(
          'INVALID_ARGUMENT',
          'Request between 1 and 200 history snapshots with a valid cursor.',
        );
      const { index } = await this.load(this.scope(request.projectId));
      const sorted = index.snapshots
        .filter((s) => s.path === path)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const position =
        request.cursor === undefined ? -1 : sorted.findIndex((s) => s.id === request.cursor);
      if (request.cursor !== undefined && position < 0)
        throw new ProjectError('CONFLICT', 'History changed. Refresh the snapshot list.');
      const snapshots = sorted.slice(position + 1, position + 1 + limit);
      return {
        snapshots,
        nextCursor: position + 1 + snapshots.length < sorted.length ? snapshots.at(-1)!.id : null,
      };
    });
  }
  private ref(value: unknown): { scope: Scope; path: string; id: string } {
    const request = record(value);
    if (
      typeof request.projectId !== 'string' ||
      typeof request.snapshotId !== 'string' ||
      !snapshotId.test(request.snapshotId)
    )
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid historical snapshot identifier.');
    return {
      scope: this.scope(request.projectId),
      path: validateRelativePath(request.path),
      id: request.snapshotId,
    };
  }
  private async content(
    scope: Scope,
    summary: HistorySnapshotSummary,
  ): Promise<HistorySnapshotContent> {
    const compressed = await scope.storage.read(
      fileParts(scope, summary.path, summary.id),
      MAX_COMPRESSED_BYTES,
    );
    if (compressed === null)
      throw new ProjectError('NOT_FOUND', 'Historical snapshot file missing.');
    try {
      const bytes = await gunzipAsync(compressed, { maxOutputLength: MAX_TEXT_BYTES });
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (bytes.length !== summary.sizeBytes || sha256(bytes) !== summary.revision) invalid();
      text(content);
      this.assertCurrent(scope);
      return { ...summary, content };
    } catch {
      return invalid();
    }
  }
  private async readSnapshot(value: HistorySnapshotRef): Promise<HistorySnapshotContent> {
    const { scope, path, id } = this.ref(value);
    const { index } = await this.load(scope);
    const summary = index.snapshots.find((s) => s.path === path && s.id === id);
    if (!summary) throw new ProjectError('NOT_FOUND', 'Historical snapshot not found.');
    return this.content(scope, summary);
  }
  read(value: HistorySnapshotRef): Promise<HistorySnapshotContent> {
    return this.serialize(() => this.readSnapshot(value));
  }
  private async createSnapshot(
    value: CreateHistorySnapshotRequest,
  ): Promise<HistorySnapshotSummary> {
    const request = record(value);
    if (
      typeof request.projectId !== 'string' ||
      typeof request.trigger !== 'string' ||
      !triggers.has(request.trigger) ||
      (request.force !== undefined && typeof request.force !== 'boolean')
    )
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid snapshot request.');
    const path = validateRelativePath(request.path);
    const content = text(request.content);
    const snapshotLabel = label(request.label);
    const scope = this.scope(request.projectId);
    const { index, bytes } = await this.load(scope);
    const revision = sha256(content);
    const latest = index.snapshots
      .filter((s) => s.path === path)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!request.force && latest?.revision === revision) return latest;
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replace(/:/g, '-')}-${randomUUID()}`;
    const summary: HistorySnapshotSummary = {
      id,
      path,
      createdAt,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      revision,
      trigger: request.trigger as HistorySnapshotSummary['trigger'],
      pinned: Boolean(snapshotLabel),
      label: snapshotLabel,
    };
    const next = { version: 1 as const, snapshots: [...index.snapshots, summary] };
    if (next.snapshots.length > MAX_SNAPSHOTS)
      throw new ProjectError('HISTORY_LIMIT', 'File history has reached its snapshot limit.');
    const compressed = await gzipAsync(Buffer.from(content, 'utf8'), { level: 9 });
    this.assertCurrent(scope);
    await scope.storage.write(fileParts(scope, path, id), compressed, null, MAX_COMPRESSED_BYTES);
    // Publication failures leave recoverable orphan bytes rather than risk deleting
    // a snapshot after an index rename succeeded but cleanup reported an error.
    await this.save(scope, next, bytes);
    return summary;
  }
  create(value: CreateHistorySnapshotRequest): Promise<HistorySnapshotSummary> {
    return this.serialize(() => this.createSnapshot(value));
  }
  async createFromDisk(
    value: Omit<CreateHistorySnapshotRequest, 'content'>,
  ): Promise<HistorySnapshotSummary> {
    const snapshot = await this.projects.readFile(value);
    return this.create({ ...value, content: snapshot.content });
  }
  pin(value: PinHistorySnapshotRequest): Promise<HistorySnapshotSummary> {
    return this.serialize(async () => {
      const { scope, path, id } = this.ref(value);
      const request = record(value);
      if (typeof request.pinned !== 'boolean')
        throw new ProjectError('INVALID_ARGUMENT', 'Pinned must be a boolean.');
      const { index, bytes } = await this.load(scope);
      const summary = index.snapshots.find((s) => s.path === path && s.id === id);
      if (!summary) throw new ProjectError('NOT_FOUND', 'Historical snapshot not found.');
      summary.label = label(request.label);
      summary.pinned = request.pinned || Boolean(summary.label);
      await this.save(scope, index, bytes);
      return summary;
    });
  }
  restore(value: RestoreHistorySnapshotRequest): Promise<FileSnapshot> {
    return this.serialize(async () => {
      const historical = await this.readSnapshot(value);
      const recoveryBuffer = text(record(value).recoveryBuffer);
      const disk = await this.projects.readFile(value);
      if (disk.revision !== value.expectedRevision)
        throw new ProjectError('CONFLICT', 'The file changed on disk. Review it before restoring.');
      await this.createSnapshot({
        ...value,
        content: recoveryBuffer,
        trigger: 'manual',
        force: true,
        label: 'Pre-restore editor backup',
      });
      if (disk.content !== recoveryBuffer)
        await this.createSnapshot({
          ...value,
          content: disk.content,
          trigger: 'manual',
          force: true,
          label: 'Pre-restore disk backup',
        });
      return this.projects.saveFile({ ...value, content: historical.content });
    });
  }
  async exportSnapshot(value: HistorySnapshotRef, window: BrowserWindow): Promise<boolean> {
    const historical = await this.read(value);
    const result = await dialog.showSaveDialog(window, {
      title: 'Export file snapshot',
      defaultPath: `${basename(value.path)}.${historical.id}.tex`,
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
      await unlink(temp).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
    }
    return true;
  }
  deleteSnapshot(value: HistorySnapshotRef): Promise<void> {
    return this.serialize(async () => {
      const { scope, path, id } = this.ref(value);
      const { index, bytes } = await this.load(scope);
      const summary = index.snapshots.find((s) => s.path === path && s.id === id);
      if (!summary) throw new ProjectError('NOT_FOUND', 'Historical snapshot not found.');
      const parts = fileParts(scope, path, id);
      await scope.storage.resolve(parts, 'file');
      await this.save(
        scope,
        { version: 1, snapshots: index.snapshots.filter((s) => s !== summary) },
        bytes,
      );
      await scope.storage.remove(parts);
    });
  }
  prune(projectId: string, nowMs = Date.now()): Promise<number> {
    return this.serialize(async () => {
      const scope = this.scope(projectId);
      const { index, bytes } = await this.load(scope);
      const byFile = new Map<string, HistorySnapshotSummary[]>();
      const keep = new Set<HistorySnapshotSummary>();
      for (const snapshot of index.snapshots) {
        if (snapshot.pinned || snapshot.label) keep.add(snapshot);
        else {
          const group = byFile.get(snapshot.path) ?? [];
          group.push(snapshot);
          byFile.set(snapshot.path, group);
        }
      }
      for (const snapshots of byFile.values()) {
        snapshots.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const buckets = new Map<string, HistorySnapshotSummary>();
        for (const snapshot of snapshots) {
          const age = nowMs - Date.parse(snapshot.createdAt);
          const days = age / DAY_MS;
          if (days <= 30 && (snapshot.trigger !== 'save' || age <= 30 * 60 * 1000))
            keep.add(snapshot);
          else {
            const key =
              days <= 30
                ? `ten:${Math.floor(Date.parse(snapshot.createdAt) / (10 * 60 * 1000))}`
                : days <= 90
                  ? `day:${snapshot.createdAt.slice(0, 10)}`
                  : days <= 365
                    ? `week:${getIsoWeek(new Date(snapshot.createdAt))}`
                    : `month:${snapshot.createdAt.slice(0, 7)}`;
            buckets.set(key, snapshot);
          }
        }
        for (const snapshot of buckets.values()) keep.add(snapshot);
      }
      const removed = index.snapshots.filter((s) => !keep.has(s));
      if (!removed.length) return 0;
      for (const s of removed) await scope.storage.resolve(fileParts(scope, s.path, s.id), 'file');
      // A failed publication must leave every previously indexed snapshot intact.
      await this.save(
        scope,
        { version: 1, snapshots: index.snapshots.filter((s) => keep.has(s)) },
        bytes,
      );
      for (const s of removed) await scope.storage.remove(fileParts(scope, s.path, s.id));
      return removed.length;
    });
  }
  listLegacy(projectId: string): Promise<LegacyHistorySummary[]> {
    return this.serialize(async () => {
      this.projects.getRoot(projectId);
      if (!this.userDataDir) return [];
      const storage = new HistoryStorage(this.userDataDir);
      let names: string[];
      try {
        names = await storage.directories(['history'], 200);
      } catch (error) {
        if (isMissing(error)) return [];
        throw error;
      }
      const summaries: LegacyHistorySummary[] = [];
      for (const id of names.filter((name) => legacyId.test(name)).sort()) {
        const bytes = await storage.read(['history', id, 'index.json'], MAX_INDEX_BYTES);
        if (bytes === null) continue;
        const { snapshots } = parseIndex(bytes);
        summaries.push({
          id,
          snapshotCount: snapshots.length,
          latestCreatedAt: snapshots.reduce<string | null>(
            (latest, s) => (latest === null || s.createdAt > latest ? s.createdAt : latest),
            null,
          ),
          samplePaths: [...new Set(snapshots.map((s) => s.path))].slice(0, 5),
        });
      }
      this.projects.getRoot(projectId);
      return summaries;
    });
  }
  importLegacy(value: { projectId: string; legacyId: string }): Promise<number> {
    return this.serialize(async () => {
      const request = record(value);
      if (
        typeof request.projectId !== 'string' ||
        typeof request.legacyId !== 'string' ||
        !legacyId.test(request.legacyId) ||
        !this.userDataDir
      )
        throw new ProjectError(
          'INVALID_ARGUMENT',
          'Choose a legacy history store from the recovery list.',
        );
      const scope = this.scope(request.projectId);
      const source: Scope = {
        storage: new HistoryStorage(this.userDataDir),
        parts: ['history', request.legacyId],
        projectId: request.projectId,
      };
      const sourceState = await this.load(source);
      if (sourceState.bytes === null)
        throw new ProjectError('NOT_FOUND', 'Legacy history store not found.');
      const { index, bytes } = await this.load(scope);
      const additions: HistorySnapshotSummary[] = [];
      for (const original of sourceState.index.snapshots) {
        const existing = index.snapshots.find(
          (s) => s.path === original.path && s.id === original.id,
        );
        if (existing?.revision === original.revision) continue;
        const content = await this.content(source, original);
        const summary = {
          ...original,
          id: existing ? `${original.id.slice(0, 60)}-${randomUUID()}` : original.id,
        };
        const compressed = await gzipAsync(Buffer.from(content.content, 'utf8'), { level: 9 });
        this.assertCurrent(scope);
        const destination = fileParts(scope, summary.path, summary.id);
        const orphan = await scope.storage.read(destination, MAX_COMPRESSED_BYTES);
        if (orphan === null)
          await scope.storage.write(destination, compressed, null, MAX_COMPRESSED_BYTES);
        else await this.content(scope, summary); // A prior interrupted import may have published these bytes.
        additions.push(summary);
      }
      if (additions.length)
        await this.save(
          scope,
          { version: 1, snapshots: [...index.snapshots, ...additions] },
          bytes,
        );
      return additions.length;
    });
  }
}
