import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectConflictPolicyService } from '../../src/main/services/project-conflict-policy';

describe('ProjectConflictPolicyService', () => {
  let directory = '';

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = '';
  });

  it('defaults to manual review and persists policy per canonical project root', async () => {
    directory = await mkdtemp(join(tmpdir(), 'textra-policy-'));
    const roots = new Map([
      ['first', join(directory, 'first')],
      ['same-first', join(directory, 'first')],
      ['second', join(directory, 'second')],
    ]);
    const service = new ProjectConflictPolicyService(directory, (id) => {
      const root = roots.get(id);
      if (!root) throw new Error('unknown project');
      return root;
    });

    expect(await service.get('first')).toBe('manual-review');
    expect(await service.set('first', 'background-merge')).toBe('background-merge');
    expect(await service.get('same-first')).toBe('background-merge');
    expect(await service.get('second')).toBe('manual-review');
    await service.flush();

    const stored = await readFile(join(directory, 'project-conflict-policies.json'), 'utf8');
    expect(stored).not.toContain(join(directory, 'first'));
    expect(JSON.parse(stored)).toMatchObject({ version: 1 });
  });

  it('rejects invalid policy values without writing them', async () => {
    directory = await mkdtemp(join(tmpdir(), 'textra-policy-'));
    const service = new ProjectConflictPolicyService(directory, () => directory);
    expect(() => service.set('project', 'merge-anything')).toThrow();
  });
});
