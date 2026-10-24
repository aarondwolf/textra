import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  discardAll,
  editDocument,
  openDocument,
  selectDocument,
  reloadDocument,
  saveAll,
  saveDocument,
  sortProjectTexFiles,
  useWorkspace,
  type OpenDocument,
} from '../../src/renderer/src/state/workspace';
import type { FileEntry, FileSnapshot, ProjectInfo, Result } from '../../src/shared/api';

const project: ProjectInfo = {
  id: 'a',
  name: 'a',
  rootPath: '/a',
  mainFile: 'main.tex',
  files: [],
  truncated: false,
};
function document(path = 'main.tex'): OpenDocument {
  return {
    projectId: 'a',
    path,
    content: 'original',
    savedContent: 'original',
    revision: 'old',
    conflict: false,
    externalState: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const snapshot = (path: string): Result<FileSnapshot> => ({
  ok: true,
  value: { projectId: 'a', path, content: 'disk', revision: 'new' },
});

describe('editor state preserves concurrent work', () => {
  beforeEach(() => {
    useWorkspace.setState(
      {
        ...useWorkspace.getInitialState(),
        project,
        documents: [document()],
        activePath: 'main.tex',
      },
      true,
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  it('does not replace text edited while a disk reload is pending', async () => {
    const read = deferred<Result<FileSnapshot>>();
    vi.stubGlobal('window', { textra: { readFile: () => read.promise } });
    const loading = reloadDocument('main.tex');
    editDocument('main.tex', 'new writing');
    read.resolve(snapshot('main.tex'));
    await loading;
    expect(useWorkspace.getState().documents[0].content).toBe('new writing');
  });
  it('ignores a reload completed after a project switch', async () => {
    const read = deferred<Result<FileSnapshot>>();
    vi.stubGlobal('window', { textra: { readFile: () => read.promise } });
    const loading = reloadDocument('main.tex');
    useWorkspace.setState({
      project: { ...project, id: 'b' },
      documents: [{ ...document(), projectId: 'b', content: 'other project' }],
    });
    read.resolve(snapshot('main.tex'));
    await loading;
    expect(useWorkspace.getState().documents[0].content).toBe('other project');
  });
  it('keeps an explicit existing-tab selection ahead of a late file read', async () => {
    const read = deferred<Result<FileSnapshot>>();
    vi.stubGlobal('window', { textra: { readFile: () => read.promise } });
    const opening = openDocument('chapter.tex');
    selectDocument('main.tex');
    read.resolve(snapshot('chapter.tex'));
    await opening;
    expect(useWorkspace.getState().activePath).toBe('main.tex');
    expect(useWorkspace.getState().documents.map((item) => item.path)).toEqual([
      'main.tex',
      'chapter.tex',
    ]);
  });
  it('bounds concurrent tab opens without disabling external conflict polling', async () => {
    const one = deferred<Result<FileSnapshot>>();
    const two = deferred<Result<FileSnapshot>>();
    useWorkspace.setState({
      documents: Array.from({ length: 49 }, (_, index) => document(`${index}.tex`)),
    });
    vi.stubGlobal('window', {
      textra: {
        readFile: ({ path }: { path: string }) => (path === 'one.tex' ? one.promise : two.promise),
      },
    });
    const first = openDocument('one.tex');
    const second = openDocument('two.tex');
    one.resolve(snapshot('one.tex'));
    await first;
    two.resolve(snapshot('two.tex'));
    await second;
    expect(useWorkspace.getState().documents).toHaveLength(50);
    expect(useWorkspace.getState().activePath).toBe('one.tex');
    expect(useWorkspace.getState().error).toContain('50');
  });
  it('atomically replaces an unedited preview tab when opening a new document', async () => {
    const read = deferred<Result<FileSnapshot>>();
    vi.stubGlobal('window', { textra: { readFile: () => read.promise } });
    useWorkspace.setState({
      documents: [document('preview.tex')],
      activePath: 'preview.tex',
    });
    const opening = openDocument('chapter.tex', undefined, { replacePath: 'preview.tex' });
    // While loading, preview.tex remains open so the editor does not unmount
    expect(useWorkspace.getState().documents.map((d) => d.path)).toEqual(['preview.tex']);
    expect(useWorkspace.getState().activePath).toBe('preview.tex');

    read.resolve(snapshot('chapter.tex'));
    await opening;

    // Atomically replaced in a single state transition
    expect(useWorkspace.getState().documents.map((d) => d.path)).toEqual(['chapter.tex']);
    expect(useWorkspace.getState().activePath).toBe('chapter.tex');
  });
  it('does not replace a dirty document during atomic tab open', async () => {
    const read = deferred<Result<FileSnapshot>>();
    vi.stubGlobal('window', { textra: { readFile: () => read.promise } });
    useWorkspace.setState({
      documents: [{ ...document('dirty.tex'), content: 'unsaved modifications' }],
      activePath: 'dirty.tex',
    });
    const opening = openDocument('chapter.tex', undefined, { replacePath: 'dirty.tex' });
    read.resolve(snapshot('chapter.tex'));
    await opening;

    expect(useWorkspace.getState().documents.map((d) => d.path)).toEqual([
      'dirty.tex',
      'chapter.tex',
    ]);
    expect(useWorkspace.getState().activePath).toBe('chapter.tex');
  });
  it('retains typing performed during a save and marks only the saved revision clean', async () => {
    const write = deferred<Result<FileSnapshot>>();
    vi.stubGlobal('window', { textra: { saveFile: () => write.promise } });
    editDocument('main.tex', 'first edit');
    const saving = saveDocument('main.tex');
    editDocument('main.tex', 'later edit');
    write.resolve({ ok: true, value: { ...document(), content: 'first edit', revision: 'new' } });
    expect(await saving).toBe(true);
    expect(useWorkspace.getState().documents[0]).toMatchObject({
      content: 'later edit',
      savedContent: 'first edit',
      revision: 'new',
    });
  });
  it('synchronizes the clean flag before returning from Save All', async () => {
    const flag = vi.fn(async () => ({ ok: true, value: undefined }));
    vi.stubGlobal('window', { textra: { setDirty: flag } });
    expect(await saveAll()).toBe(true);
    expect(flag).toHaveBeenCalledWith(false);
  });
  it('coalesces overlapping saves and uses the completed disk revision for newer edits', async () => {
    const first = deferred<Result<FileSnapshot>>();
    const saveFile = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async (request) => ({
        ok: true,
        value: { ...document(), content: request.content, revision: 'second-revision' },
      }));
    vi.stubGlobal('window', { textra: { saveFile } });
    editDocument('main.tex', 'first edit');
    const firstSave = saveDocument('main.tex');
    editDocument('main.tex', 'second edit');
    const secondSave = saveDocument('main.tex');
    expect(saveFile).toHaveBeenCalledTimes(1);
    first.resolve({
      ok: true,
      value: { ...document(), content: 'first edit', revision: 'first-revision' },
    });
    expect(await firstSave).toBe(true);
    expect(await secondSave).toBe(true);
    expect(saveFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'second edit', expectedRevision: 'first-revision' }),
    );
    expect(useWorkspace.getState().documents[0]).toMatchObject({
      content: 'second edit',
      savedContent: 'second edit',
      conflict: false,
    });
  });

  it('does not write an unchanged document twice for overlapping save commands', async () => {
    const write = deferred<Result<FileSnapshot>>();
    const saveFile = vi.fn(() => write.promise);
    vi.stubGlobal('window', { textra: { saveFile } });
    editDocument('main.tex', 'edit');
    const first = saveDocument('main.tex');
    const second = saveDocument('main.tex');
    write.resolve({ ok: true, value: { ...document(), content: 'edit', revision: 'saved' } });
    await Promise.all([first, second]);
    expect(saveFile).toHaveBeenCalledTimes(1);
  });
  it('explicit discard resets edits while retaining an external-change warning', async () => {
    const flag = vi.fn(async () => ({ ok: true, value: undefined }));
    vi.stubGlobal('window', { textra: { setDirty: flag } });
    useWorkspace.setState({ documents: [{ ...document(), content: 'unsaved', conflict: true }] });
    await discardAll();
    expect(useWorkspace.getState().documents[0]).toMatchObject({
      content: 'original',
      conflict: true,
    });
    expect(flag).toHaveBeenCalledWith(false);
  });
});

describe('sortProjectTexFiles', () => {
  it('sorts root-level .tex files alphabetically first, then subfolder files alphabetically', () => {
    const entries: FileEntry[] = [
      { path: 'chapters/intro.tex', name: 'intro.tex', kind: 'file' },
      { path: 'main.tex', name: 'main.tex', kind: 'file' },
      { path: 'appendix.tex', name: 'appendix.tex', kind: 'file' },
      { path: 'chapters/conclusion.tex', name: 'conclusion.tex', kind: 'file' },
      { path: 'notes/meeting.tex', name: 'meeting.tex', kind: 'file' },
      { path: 'abstract.tex', name: 'abstract.tex', kind: 'file' },
      { path: 'images/plot.png', name: 'plot.png', kind: 'file' },
      { path: 'chapters', name: 'chapters', kind: 'directory' },
    ];

    const sorted = sortProjectTexFiles(entries);

    expect(sorted.map((file) => file.path)).toEqual([
      'abstract.tex',
      'appendix.tex',
      'main.tex',
      'chapters/conclusion.tex',
      'chapters/intro.tex',
      'notes/meeting.tex',
    ]);
  });

  it('filters out non-tex files and directories', () => {
    const entries: FileEntry[] = [
      { path: 'README.md', name: 'README.md', kind: 'file' },
      { path: 'refs.bib', name: 'refs.bib', kind: 'file' },
      { path: 'src', name: 'src', kind: 'directory' },
      { path: 'document.TEX', name: 'document.TEX', kind: 'file' },
    ];

    const sorted = sortProjectTexFiles(entries);
    expect(sorted.map((f) => f.path)).toEqual(['document.TEX']);
  });

  it('returns an empty array when no .tex files exist', () => {
    expect(sortProjectTexFiles([])).toEqual([]);
  });
});
