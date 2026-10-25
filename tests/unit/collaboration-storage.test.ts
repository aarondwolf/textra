import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { CollaborationStorage } from '../../src/main/services/collaboration-storage';
import { ProjectService } from '../../src/main/services/projects';

describe('CollaborationStorage', () => {
  let directory = '';

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5 });
    directory = '';
  });

  it('publishes immutable records and detects competing initialization IDs', async () => {
    directory = await mkdtemp(join(process.cwd(), '.test-data', 'collaboration-'));
    const root = join(directory, 'project');
    const userData = join(directory, 'user-data');
    await mkdir(root, { recursive: true });
    await mkdir(userData, { recursive: true });
    await writeFile(join(root, 'main.tex'), 'saved\n');
    const projects = new ProjectService(userData);
    const project = await projects.openRoot(root);
    const storage = new CollaborationStorage(
      (id) => projects.getRoot(id),
      userData,
      (ref) => projects.readFile(ref),
    );
    const doc = new Y.Doc();
    doc.getText('source').insert(0, 'saved\n');
    const stateBase64 = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
    const ref = { projectId: project.id, path: 'main.tex' };
    const first = await storage.publish(
      ref,
      {
        initializationId: 'c7cc991c-2e09-49bf-aec8-6027d330a3f5',
        stateBase64,
        importProvenance: null,
      },
      'saved\n',
    );
    expect(first.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect((await storage.list(ref)).records).toHaveLength(1);
    await expect(
      storage.publish(
        ref,
        {
          initializationId: 'a27c5a74-73a8-40f3-a0f7-2f9ffb8843f3',
          stateBase64,
          importProvenance: null,
        },
        'saved\n',
      ),
    ).rejects.toThrow(/initialization/);
    expect((await storage.list(ref)).competingInitializations).toBe(false);
    doc.destroy();
  });

  it('recovers an outbox entry only after its saved revision is confirmed', async () => {
    directory = await mkdtemp(join(process.cwd(), '.test-data', 'collaboration-'));
    const root = join(directory, 'project');
    const userData = join(directory, 'user-data');
    await mkdir(root, { recursive: true });
    await mkdir(userData, { recursive: true });
    await writeFile(join(root, 'main.tex'), 'old\n');
    const projects = new ProjectService(userData);
    const project = await projects.openRoot(root);
    const storage = new CollaborationStorage(
      (id) => projects.getRoot(id),
      userData,
      (ref) => projects.readFile(ref),
    );
    const doc = new Y.Doc();
    doc.getText('source').insert(0, 'new\n');
    const save = {
      initializationId: 'c7cc991c-2e09-49bf-aec8-6027d330a3f5',
      stateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
      importProvenance: null,
    };
    const ref = { projectId: project.id, path: 'main.tex' };
    await storage.prepareOutbox(ref, save, 'new\n');
    expect(await storage.recoverOutbox(project.id)).toBe(0);
    const old = await projects.readFile(ref);
    await projects.saveFile({ ...ref, content: 'new\n', expectedRevision: old.revision });
    expect(await storage.recoverOutbox(project.id)).toBe(1);
    expect((await storage.list(ref)).records).toHaveLength(1);
    doc.destroy();
  });
});
