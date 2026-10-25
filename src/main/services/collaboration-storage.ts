import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from './atomic-write';
import { HistoryStorage } from './history-storage';
import { ProjectError, validateRelativePath } from './projects';
import { AsyncMutex } from './mutex';
import type {
  CollaborationRecord,
  CollaborationSaveRecord,
  FileRef,
  FileSnapshot,
} from '../../shared/api';

const MAX_RECORD_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_RECORDS = 10000;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9-]{36}$/i;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function invalid(): never {
  throw new ProjectError(
    'INVALID_COLLABORATION',
    'Collaboration records are invalid or unsupported.',
  );
}

function validateSave(value: unknown): CollaborationSaveRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const request = value as Record<string, unknown>;
  if (
    typeof request.initializationId !== 'string' ||
    !ID.test(request.initializationId) ||
    typeof request.stateBase64 !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.stateBase64) ||
    (request.importProvenance !== null &&
      (typeof request.importProvenance !== 'string' || request.importProvenance.length > 128))
  )
    return invalid();
  const bytes = Buffer.from(request.stateBase64, 'base64');
  if (!bytes.length || bytes.length > MAX_RECORD_BYTES) return invalid();
  return {
    initializationId: request.initializationId,
    stateBase64: request.stateBase64,
    importProvenance: request.importProvenance as string | null,
  };
}

/** Folder transport stores immutable Yjs state records; it never parses CRDT internals. */
export class CollaborationStorage {
  private readonly mutex = new AsyncMutex();
  constructor(
    private readonly getRoot: (projectId: string) => string,
    private readonly userData: string,
    private readonly readProjectFile: (ref: FileRef) => Promise<FileSnapshot>,
  ) {}

  private checkedPath(path: unknown): string {
    const result = validateRelativePath(path);
    if (!/\.tex$/i.test(result))
      throw new ProjectError('INVALID_ARGUMENT', 'Collaboration is available for .tex files only.');
    return result;
  }

  private recordParts(path: string, id: string): string[] {
    return ['.textra', 'crdt', sha256(path), `${id}.json`];
  }

  async list(
    ref: FileRef,
  ): Promise<{ records: CollaborationRecord[]; competingInitializations: boolean }> {
    if (!ref || typeof ref.projectId !== 'string')
      throw new ProjectError('INVALID_ARGUMENT', 'Invalid collaboration project reference.');
    const path = this.checkedPath(ref.path);
    const storage = new HistoryStorage(this.getRoot(ref.projectId));
    const directory = ['.textra', 'crdt', sha256(path)];
    const names = await storage.files(directory, MAX_RECORDS + 1);
    if (names.length > MAX_RECORDS)
      throw new ProjectError(
        'COLLABORATION_LIMIT',
        'This document has too many collaboration records.',
      );
    const records: CollaborationRecord[] = [];
    let totalBytes = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!ID.test(id)) return invalid();
      const bytes = await storage.read([...directory, name], MAX_RECORD_BYTES);
      if (!bytes) continue;
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES)
        throw new ProjectError(
          'COLLABORATION_LIMIT',
          'This document exceeds its collaboration storage limit.',
        );
      try {
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
        const item = value as Record<string, unknown>;
        const save = validateSave(item);
        const stateBytes = Buffer.from(save.stateBase64, 'base64');
        if (
          Object.keys(item).some(
            (key) =>
              ![
                'version',
                'id',
                'path',
                'initializationId',
                'stateBase64',
                'sourceRevision',
                'exportedTextHash',
                'importProvenance',
                'createdAt',
              ].includes(key),
          ) ||
          item.version !== 1 ||
          item.id !== id ||
          item.path !== path ||
          typeof item.sourceRevision !== 'string' ||
          !HASH.test(item.sourceRevision) ||
          typeof item.exportedTextHash !== 'string' ||
          !HASH.test(item.exportedTextHash) ||
          typeof item.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(item.createdAt)) ||
          stateBytes.length > MAX_RECORD_BYTES
        )
          return invalid();
        records.push({
          id,
          path,
          initializationId: save.initializationId,
          stateBase64: save.stateBase64,
          sourceRevision: item.sourceRevision,
          exportedTextHash: item.exportedTextHash,
          importProvenance: save.importProvenance,
          createdAt: item.createdAt,
        });
      } catch {
        return invalid();
      }
    }
    const initializations = new Set(records.map((record) => record.initializationId));
    return { records, competingInitializations: initializations.size > 1 };
  }

  publish(
    ref: FileRef,
    saveRecord: CollaborationSaveRecord,
    content: string,
  ): Promise<CollaborationRecord> {
    return this.mutex.run(() => this.publishOnce(ref, saveRecord, content));
  }

  private async publishOnce(
    ref: FileRef,
    saveRecord: CollaborationSaveRecord,
    content: string,
  ): Promise<CollaborationRecord> {
    const path = this.checkedPath(ref.path);
    const save = validateSave(saveRecord);
    const sourceRevision = sha256(content);
    const record: CollaborationRecord = {
      id: randomUUID(),
      path,
      ...save,
      sourceRevision,
      exportedTextHash: sourceRevision,
      createdAt: new Date().toISOString(),
    };
    const bytes = Buffer.from(`${JSON.stringify({ version: 1, ...record }, null, 2)}\n`, 'utf8');
    if (bytes.length > MAX_RECORD_BYTES)
      throw new ProjectError('COLLABORATION_LIMIT', 'A collaboration record exceeds 16 MiB.');
    const storage = new HistoryStorage(this.getRoot(ref.projectId));
    const existing = await this.list(ref);
    if (existing.competingInitializations)
      throw new ProjectError(
        'COLLABORATION_CONFLICT',
        'Document initialization requires manual review.',
      );
    if (
      existing.records.length &&
      !existing.records.some((item) => item.initializationId === save.initializationId)
    )
      throw new ProjectError(
        'COLLABORATION_CONFLICT',
        'Document initialization requires manual review.',
      );
    if (existing.records.length >= MAX_RECORDS)
      throw new ProjectError(
        'COLLABORATION_LIMIT',
        'This document has too many collaboration records.',
      );
    const currentBytes = existing.records.reduce(
      (sum, item) =>
        sum +
        Buffer.byteLength(
          JSON.stringify({
            version: 1,
            ...item,
          }),
          'utf8',
        ),
      0,
    );
    if (currentBytes + bytes.length > MAX_TOTAL_BYTES)
      throw new ProjectError(
        'COLLABORATION_LIMIT',
        'This document exceeds its collaboration storage limit.',
      );
    await storage.write(this.recordParts(path, record.id), bytes, null, MAX_RECORD_BYTES + 4096);
    return record;
  }

  async prepareOutbox(
    ref: FileRef,
    saveRecord: CollaborationSaveRecord,
    content: string,
  ): Promise<string> {
    const path = this.checkedPath(ref.path);
    const save = validateSave(saveRecord);
    const rootHash = sha256(this.getRoot(ref.projectId));
    const outbox = {
      version: 1,
      rootHash,
      path,
      expectedRevision: sha256(content),
      content,
      save,
    };
    const directory = join(this.userData, 'collaboration-outbox', rootHash);
    const filename = join(directory, `${randomUUID()}.json`);
    await writeAtomic(filename, JSON.stringify(outbox), { ensureDir: true });
    return filename;
  }

  async acknowledgeOutbox(filename: string): Promise<void> {
    await unlink(filename).catch((error: unknown) => {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT')
        throw error;
    });
  }

  async recoverOutbox(projectId: string): Promise<number> {
    const rootHash = sha256(this.getRoot(projectId));
    const directory = join(this.userData, 'collaboration-outbox', rootHash);
    let names: string[];
    try {
      names = (await readdir(directory))
        .filter((name) => name.endsWith('.json'))
        .slice(0, MAX_RECORDS);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return 0;
      throw error;
    }
    let recovered = 0;
    for (const name of names) {
      const filename = join(directory, name);
      const { lstat } = await import('node:fs/promises');
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) continue;
      const bytes = await readFile(filename);
      if (bytes.length > MAX_RECORD_BYTES + 6 * 1024 * 1024) continue;
      let item: Record<string, unknown>;
      try {
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        item = value as Record<string, unknown>;
      } catch {
        continue;
      }
      if (
        item.version !== 1 ||
        item.rootHash !== rootHash ||
        typeof item.path !== 'string' ||
        typeof item.content !== 'string' ||
        typeof item.expectedRevision !== 'string' ||
        !HASH.test(item.expectedRevision) ||
        sha256(item.content) !== item.expectedRevision
      )
        continue;
      const path = this.checkedPath(item.path);
      const record = validateSave(item.save);
      const ref = { projectId, path };
      let disk: FileSnapshot;
      try {
        disk = await this.readProjectFile(ref);
      } catch {
        continue;
      }
      if (disk.revision !== item.expectedRevision) continue;
      await this.publish(ref, record, item.content);
      await this.acknowledgeOutbox(filename);
      recovered++;
    }
    return recovered;
  }
}
