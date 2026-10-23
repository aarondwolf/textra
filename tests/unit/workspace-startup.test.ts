import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileSnapshot, ProjectInfo, RecentProject, Result } from '../../src/shared/api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const project: ProjectInfo = {
  id: 'project',
  name: 'Writing',
  rootPath: '/writing',
  mainFile: 'main.tex',
  files: [],
  truncated: false,
  treeState: 'loading',
};
const recent: RecentProject = {
  id: 'recent',
  name: project.name,
  rootPath: project.rootPath,
  pinned: false,
};
const snapshot = (path: string): Result<FileSnapshot> => ({
  ok: true,
  value: { projectId: project.id, path, content: `disk ${path}`, revision: 'revision' },
});

async function setup(
  paths = ['main.tex', 'chapter.tex'],
  activePath: string | null = 'chapter.tex',
) {
  const storage = new Map<string, string>([
    [
      'textra:workspace-session',
      JSON.stringify({ version: 1, recentId: recent.id, paths, activePath }),
    ],
  ]);
  const bridge = {
    getRecentProjects: vi.fn(async () => ({ ok: true as const, value: [recent] })),
    openRecentProject: vi.fn(async () => ({ ok: true as const, value: project })),
    getProjectConfig: vi.fn(async () => ({
      ok: true as const,
      value: { schemaVersion: 1 as const, rootFile: 'main.tex', engine: 'pdflatex' as const },
    })),
    readFile: vi.fn(async ({ path }: { path: string }) => snapshot(path)),
    getBuildState: vi.fn(),
    detectTools: vi.fn(),
  };
  const setItem = vi.fn((key: string, value: string) => {
    storage.set(key, value);
  });
  vi.stubGlobal('window', {
    textra: bridge,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem },
    setTimeout: (callback: () => void) => {
      callback();
      return 1;
    },
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  return {
    bridge,
    setItem,
    storage,
    session: await import('../../src/renderer/src/features/startup/session'),
    workspace: await import('../../src/renderer/src/state/workspace'),
    startup: await import('../../src/renderer/src/state/startup'),
  };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('workspace session restoration', () => {
  it('accepts legacy metadata while filtering unsafe paths and duplicate tabs', async () => {
    const { session } = await setup();
    expect(
      session.parseWorkspaceSession(
        JSON.stringify({
          projectId: 'legacy',
          paths: [
            'main.tex',
            '../private.tex',
            'C:\\private.tex',
            '/private.tex',
            'main.tex',
            'chapters/a.tex',
          ],
          activePath: '../private.tex',
        }),
      ),
    ).toEqual({
      version: 1,
      recentId: 'legacy',
      paths: ['main.tex', 'chapters/a.tex'],
      activePath: null,
    });
    for (const raw of [null, 'broken', '[]', '{"version":2}', 'x'.repeat(256_001)])
      expect(session.parseWorkspaceSession(raw)).toBeNull();
  });

  it('loads the active document first and preserves saved tab order after background reads', async () => {
    const { bridge, session, workspace, startup } = await setup();
    const chapter = deferred<Result<FileSnapshot>>();
    bridge.readFile.mockImplementation(({ path }) =>
      path === 'chapter.tex' ? chapter.promise : Promise.resolve(snapshot(path)),
    );
    const restoring = session.restoreWorkspaceSession();
    expect(session.restoreWorkspaceSession()).toBe(restoring);
    await vi.waitFor(() => expect(bridge.readFile).toHaveBeenCalledTimes(1));
    expect(bridge.readFile.mock.calls[0][0].path).toBe('chapter.tex');
    chapter.resolve(snapshot('chapter.tex'));
    await restoring;
    expect(workspace.useWorkspace.getState().activePath).toBe('chapter.tex');
    expect(workspace.useWorkspace.getState().documents.map((item) => item.path)).toEqual([
      'main.tex',
      'chapter.tex',
    ]);
    expect(startup.useStartup.getState().restoration).toBe('settled');
    expect(bridge.openRecentProject).toHaveBeenCalledTimes(1);
  });

  it('falls back to an available saved tab when the active file is missing', async () => {
    const { bridge, session, workspace } = await setup(['main.tex'], 'missing.tex');
    bridge.readFile.mockImplementation(async ({ path }) =>
      path === 'missing.tex' ? { ok: false, error: 'Missing file' } : snapshot(path),
    );
    await session.restoreWorkspaceSession();
    expect(workspace.useWorkspace.getState().activePath).toBe('main.tex');
    expect(workspace.useWorkspace.getState().error).toContain('unavailable');
  });

  it('publishes the active buffer before project settings and other tabs finish', async () => {
    const { bridge, session, workspace, startup } = await setup();
    const config = deferred<Awaited<ReturnType<typeof bridge.getProjectConfig>>>();
    const background = deferred<Result<FileSnapshot>>();
    bridge.getProjectConfig.mockReturnValue(config.promise);
    bridge.readFile.mockImplementation(({ path }) =>
      path === 'main.tex' ? background.promise : Promise.resolve(snapshot(path)),
    );
    const restoring = session.restoreWorkspaceSession();
    await vi.waitFor(() =>
      expect(workspace.useWorkspace.getState().activePath).toBe('chapter.tex'),
    );
    expect(workspace.useWorkspace.getState().configReady).toBe(false);
    expect(startup.useStartup.getState().restoration).toBe('restoring');
    workspace.editDocument('chapter.tex', 'writing immediately');
    background.resolve(snapshot('main.tex'));
    config.resolve({
      ok: true,
      value: { schemaVersion: 1, rootFile: 'main.tex', engine: 'pdflatex' },
    });
    await restoring;
    expect(workspace.useWorkspace.getState().activePath).toBe('chapter.tex');
    expect(
      workspace.useWorkspace.getState().documents.find((item) => item.path === 'chapter.tex')
        ?.content,
    ).toBe('writing immediately');
    expect(workspace.useWorkspace.getState().configReady).toBe(true);
  });

  it('keeps an explicitly opened tab selected when a restore read completes later', async () => {
    const { bridge, session, workspace } = await setup();
    const chapter = deferred<Result<FileSnapshot>>();
    bridge.readFile.mockImplementation(({ path }) =>
      path === 'chapter.tex' ? chapter.promise : Promise.resolve(snapshot(path)),
    );
    const restoring = session.restoreWorkspaceSession();
    await vi.waitFor(() => expect(bridge.readFile).toHaveBeenCalledTimes(1));
    await workspace.openDocument('chosen.tex');
    chapter.resolve(snapshot('chapter.tex'));
    await restoring;
    expect(workspace.useWorkspace.getState().activePath).toBe('chosen.tex');
    expect(bridge.readFile.mock.calls.map(([request]) => request.path)).not.toContain('main.tex');
  });

  it('keeps a closed active tab closed while the remaining restore reads settle', async () => {
    const { bridge, session, workspace } = await setup(['main.tex', 'appendix.tex', 'chapter.tex']);
    const background = deferred<Result<FileSnapshot>>();
    bridge.readFile.mockImplementation(({ path }) =>
      path === 'main.tex' ? background.promise : Promise.resolve(snapshot(path)),
    );
    const restoring = session.restoreWorkspaceSession();
    await vi.waitFor(() =>
      expect(bridge.readFile.mock.calls.map(([request]) => request.path)).toEqual([
        'chapter.tex',
        'main.tex',
      ]),
    );
    expect(workspace.useWorkspace.getState().activePath).toBe('chapter.tex');
    workspace.closeDocument('chapter.tex');
    background.resolve(snapshot('main.tex'));
    await restoring;
    expect(workspace.useWorkspace.getState().activePath).toBeNull();
    expect(workspace.useWorkspace.getState().documents).toEqual([]);
    expect(
      workspace.useWorkspace
        .getState()
        .documents.some((document) => document.path === 'chapter.tex'),
    ).toBe(false);
    expect(bridge.readFile.mock.calls.map(([request]) => request.path)).not.toContain(
      'appendix.tex',
    );
  });

  it('ignores late restore reads after changing projects', async () => {
    const { bridge, session, workspace } = await setup();
    const chapter = deferred<Result<FileSnapshot>>();
    bridge.readFile.mockImplementation(() => chapter.promise);
    const restoring = session.restoreWorkspaceSession();
    await vi.waitFor(() => expect(bridge.readFile).toHaveBeenCalledTimes(1));
    await workspace.setProject({ ...project, id: 'other', rootPath: '/other' });
    chapter.resolve(snapshot('chapter.tex'));
    await restoring;
    expect(workspace.useWorkspace.getState().project?.id).toBe('other');
    expect(workspace.useWorkspace.getState().documents).toEqual([]);
  });

  it('does not persist a partial restore or persist when session restore is disabled', async () => {
    const { session, workspace, startup, setItem } = await setup();
    workspace.useWorkspace.setState({ project, recents: [recent] });
    startup.useStartup.setState({ restoration: 'restoring' });
    session.persistWorkspaceSession(true);
    expect(setItem).not.toHaveBeenCalled();
    await session.restoreWorkspaceSession();
    session.persistWorkspaceSession(false);
    expect(setItem).not.toHaveBeenCalled();
    session.persistWorkspaceSession(true);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(setItem.mock.calls[0][1]).activePath).toBe('chapter.tex');
  });
});

describe('independent workspace readiness', () => {
  it('publishes build state while recent-project metadata is pending', async () => {
    const { bridge, workspace } = await setup();
    const recents = deferred<Awaited<ReturnType<typeof bridge.getRecentProjects>>>();
    bridge.getRecentProjects.mockReturnValue(recents.promise);
    bridge.getBuildState.mockResolvedValue({
      ok: true,
      value: { ...workspace.idleBuild, log: 'ready' },
    });
    const initializing = workspace.initializeWorkspace();
    await vi.waitFor(() => expect(workspace.useWorkspace.getState().build.log).toBe('ready'));
    expect(workspace.useWorkspace.getState().recents).toEqual([]);
    expect(bridge.detectTools).not.toHaveBeenCalled();
    recents.resolve({ ok: true, value: [recent] });
    await initializing;
  });

  it('publishes recents while build state is pending without discovering tools', async () => {
    const { bridge, workspace } = await setup();
    const build = deferred<Result<typeof workspace.idleBuild>>();
    bridge.getBuildState.mockReturnValue(build.promise);
    const initializing = workspace.initializeWorkspace();
    await vi.waitFor(() => expect(workspace.useWorkspace.getState().recents).toEqual([recent]));
    expect(bridge.detectTools).not.toHaveBeenCalled();
    build.resolve({ ok: true, value: { ...workspace.idleBuild, log: 'last build' } });
    await initializing;
    expect(workspace.useWorkspace.getState().build.log).toBe('last build');
  });

  it('deduplicates concurrent reads of the same tab', async () => {
    const { bridge, workspace } = await setup();
    workspace.useWorkspace.setState({ project });
    const read = deferred<Result<FileSnapshot>>();
    bridge.readFile.mockImplementation(() => read.promise);
    const opening = workspace.openDocument('main.tex');
    const duplicate = workspace.openDocument('main.tex');
    expect(bridge.readFile).toHaveBeenCalledTimes(1);
    read.resolve(snapshot('main.tex'));
    await Promise.all([opening, duplicate]);
    expect(workspace.useWorkspace.getState().documents).toHaveLength(1);
    expect(workspace.useWorkspace.getState().activePath).toBe('main.tex');
  });

  it('does not overwrite an editor buffer that appeared while a disk read was pending', async () => {
    const { bridge, workspace } = await setup();
    workspace.useWorkspace.setState({ project });
    const read = deferred<Result<FileSnapshot>>();
    bridge.readFile.mockImplementation(() => read.promise);
    const opening = workspace.openDocument('main.tex', undefined, { background: true });
    workspace.useWorkspace.setState({
      documents: [
        {
          projectId: project.id,
          path: 'main.tex',
          content: 'new writing',
          savedContent: 'original',
          revision: 'revision',
          conflict: false,
          externalState: null,
        },
      ],
      activePath: 'main.tex',
    });
    read.resolve(snapshot('main.tex'));
    await opening;
    expect(workspace.useWorkspace.getState().documents).toHaveLength(1);
    expect(workspace.useWorkspace.getState().documents[0].content).toBe('new writing');
  });
});
