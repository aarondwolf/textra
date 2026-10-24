import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyFormatting,
  prepareFormatting,
  restoreHistoryDocument,
} from '../../src/renderer/src/state/document-actions';
import {
  editDocument,
  useWorkspace,
  type OpenDocument,
} from '../../src/renderer/src/state/workspace';
import type { FileSnapshot, HistorySnapshotSummary, Result } from '../../src/shared/api';

const document: OpenDocument = {
  projectId: 'project',
  path: 'main.tex',
  content: 'unsaved text',
  savedContent: 'disk text',
  revision: 'disk-revision',
  conflict: false,
  externalState: null,
};
const snapshot: HistorySnapshotSummary = {
  id: 'snapshot',
  path: 'main.tex',
  createdAt: new Date(0).toISOString(),
  sizeBytes: 7,
  revision: 'historical',
  trigger: 'manual',
  pinned: false,
  label: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  useWorkspace.setState(
    {
      ...useWorkspace.getInitialState(),
      project: {
        id: 'project',
        name: 'Project',
        rootPath: '/project',
        mainFile: 'main.tex',
        files: [],
        truncated: false,
      },
      documents: [{ ...document }],
      activePath: 'main.tex',
    },
    true,
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('approved document actions', () => {
  it('captures formatting input and rejects a preview after intervening edits', async () => {
    vi.stubGlobal('window', {
      textra: { formatLatex: async () => ({ ok: true, value: { content: 'formatted text' } }) },
    });
    const preview = await prepareFormatting('project', 'main.tex');
    expect(preview).not.toBeNull();
    editDocument('main.tex', 'new writing');
    expect(applyFormatting(preview!)).toBe(false);
    expect(useWorkspace.getState().documents[0].content).toBe('new writing');
  });

  it('ignores a formatting result completed after the buffer changes', async () => {
    const pending = deferred<{ ok: true; value: { content: string } }>();
    vi.stubGlobal('window', { textra: { formatLatex: () => pending.promise } });
    const formatting = prepareFormatting('project', 'main.tex');
    editDocument('main.tex', 'new writing');
    pending.resolve({ ok: true, value: { content: 'formatted old text' } });
    expect(await formatting).toBeNull();
  });

  it('passes dirty buffer recovery text and preserves newer typing after restore completes', async () => {
    const pending = deferred<Result<FileSnapshot>>();
    const restoreFileHistorySnapshot = vi.fn(() => pending.promise);
    vi.stubGlobal('window', { textra: { restoreFileHistorySnapshot } });
    const restoring = restoreHistoryDocument('project', snapshot);
    expect(restoreFileHistorySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryBuffer: 'unsaved text',
        expectedRevision: 'disk-revision',
      }),
    );
    editDocument('main.tex', 'newer writing');
    pending.resolve({
      ok: true,
      value: { ...document, content: 'historical text', revision: 'restored-revision' },
    });
    await restoring;
    expect(useWorkspace.getState().documents[0]).toMatchObject({
      content: 'newer writing',
      savedContent: 'historical text',
      revision: 'restored-revision',
    });
  });

  it('keeps the buffer untouched when mandatory backup or restore fails', async () => {
    vi.stubGlobal('window', {
      textra: {
        restoreFileHistorySnapshot: async () => ({ ok: false, error: 'Recovery backup failed' }),
      },
    });
    expect((await restoreHistoryDocument('project', snapshot)).ok).toBe(false);
    expect(useWorkspace.getState().documents[0]).toEqual(document);
  });

  it('does not apply a late restore to a newly opened document with the same path', async () => {
    const pending = deferred<Result<FileSnapshot>>();
    vi.stubGlobal('window', { textra: { restoreFileHistorySnapshot: () => pending.promise } });
    const restoring = restoreHistoryDocument('project', snapshot);
    useWorkspace.setState({ documents: [] });
    useWorkspace.setState({ documents: [{ ...document, content: 'reopened writing' }] });
    pending.resolve({
      ok: true,
      value: { ...document, content: 'historical text', revision: 'restored-revision' },
    });
    await restoring;
    expect(useWorkspace.getState().documents[0].content).toBe('reopened writing');
  });
});
