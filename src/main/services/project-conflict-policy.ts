import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConflictPolicy } from '../../shared/api';
import { writeAtomic } from './atomic-write';
import { AsyncMutex } from './mutex';
import { ProjectError } from './projects';

interface PolicyFile {
  version: 1;
  policies: Record<string, ConflictPolicy>;
}

const maximumEntries = 500;
const validPolicy = (value: unknown): value is ConflictPolicy =>
  value === 'manual-review' || value === 'background-merge';

/** Stores project policy in app userData; only a digest of the canonical root is persisted. */
export class ProjectConflictPolicyService {
  private readonly mutex = new AsyncMutex();
  private readonly filename: string;

  constructor(
    userData: string,
    private readonly getRoot: (projectId: string) => string,
  ) {
    this.filename = join(userData, 'project-conflict-policies.json');
  }

  async flush(): Promise<void> {
    await this.mutex.flush();
  }

  private key(projectId: string): string {
    const root = this.getRoot(projectId);
    const normalized = process.platform === 'win32' ? root.toLowerCase() : root;
    return createHash('sha256').update(normalized).digest('hex');
  }

  private async read(): Promise<PolicyFile> {
    try {
      const text = await readFile(this.filename, 'utf8');
      if (Buffer.byteLength(text, 'utf8') > 128 * 1024) throw new Error('too large');
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
      const data = value as Record<string, unknown>;
      if (
        data.version !== 1 ||
        !data.policies ||
        typeof data.policies !== 'object' ||
        Array.isArray(data.policies)
      )
        throw new Error('invalid');
      const entries = Object.entries(data.policies);
      if (
        entries.length > maximumEntries ||
        entries.some(([key, policy]) => !/^[a-f0-9]{64}$/.test(key) || !validPolicy(policy))
      )
        throw new Error('invalid');
      return { version: 1, policies: Object.fromEntries(entries) as Record<string, ConflictPolicy> };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return { version: 1, policies: {} };
      throw new ProjectError('INVALID_SETTINGS', 'Local project collaboration settings are invalid.');
    }
  }

  get(projectId: string): Promise<ConflictPolicy> {
    return this.mutex.run(async () => {
      const key = this.key(projectId);
      return (await this.read()).policies[key] ?? 'manual-review';
    });
  }

  set(projectId: string, policy: unknown): Promise<ConflictPolicy> {
    if (!validPolicy(policy))
      throw new ProjectError('INVALID_ARGUMENT', 'Choose a supported project conflict policy.');
    return this.mutex.run(async () => {
      const key = this.key(projectId);
      const current = await this.read();
      const policies = { ...current.policies, [key]: policy };
      if (Object.keys(policies).length > maximumEntries)
        throw new ProjectError('SETTINGS_LIMIT', 'Too many local project settings are stored.');
      await writeAtomic(this.filename, `${JSON.stringify({ version: 1, policies }, null, 2)}\n`);
      return policy;
    });
  }
}
