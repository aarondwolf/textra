import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '../../src/shared/api';
import {
  includeProjectFile,
  mergeProjectDirectory,
  removeProjectEntry,
  refreshLoadedProjectTree,
} from '../../src/shared/project-tree';

const project: ProjectInfo = {
  id: 'project',
  name: 'Project',
  rootPath: '/project',
  mainFile: 'main.tex',
  truncated: false,
  treeState: 'partial',
  directoryPages: { '': null },
  files: [
    { path: 'chapters', name: 'chapters', kind: 'directory' },
    { path: 'main.tex', name: 'main.tex', kind: 'file' },
  ],
};

describe('incremental project tree', () => {
  it('refreshes the loaded page budgets before replacing visible rows', async () => {
    const previous: ProjectInfo = {
      ...project,
      directoryPages: { '': null, chapters: 2 },
      files: [
        ...project.files,
        { path: 'chapters/one.tex', name: 'one.tex', kind: 'file' },
        { path: 'chapters/two.tex', name: 'two.tex', kind: 'file' },
      ],
    };
    const next = await refreshLoadedProjectTree(
      previous,
      { ...project, listingId: 'refreshed' },
      async ({ path, offset }) => ({
        projectId: project.id,
        path,
        entries: [
          {
            path: offset ? 'chapters/two.tex' : 'chapters/one.tex',
            name: offset ? 'two.tex' : 'one.tex',
            kind: 'file',
          },
        ],
        nextOffset: offset ? null : 1,
      }),
    );
    expect(next.files.map((file) => file.path)).toEqual([
      'chapters',
      'chapters/one.tex',
      'chapters/two.tex',
      'main.tex',
    ]);
    expect(next.directoryPages!.chapters).toBeNull();
    expect(next.listingId).toBe('refreshed');
    expect(previous.files).toHaveLength(4);
  });
  it('keeps cached pages and sibling branches after deletion and adjusts the page cursor', () => {
    const loaded: ProjectInfo = {
      ...project,
      listingId: 'before',
      directoryPages: { '': null, chapters: 500, 'chapters/deep': null },
      files: [
        ...project.files,
        { path: 'chapters/one.tex', name: 'one.tex', kind: 'file' },
        { path: 'chapters/two.tex', name: 'two.tex', kind: 'file' },
        { path: 'chapters/deep', name: 'deep', kind: 'directory' },
        { path: 'chapters/deep/three.tex', name: 'three.tex', kind: 'file' },
      ],
    };
    const refreshed = { ...project, listingId: 'after' };
    const next = removeProjectEntry(loaded, 'chapters/one.tex', refreshed);
    expect(next.files.map((file) => file.path)).toEqual(
      loaded.files.map((file) => file.path).filter((path) => path !== 'chapters/one.tex'),
    );
    expect(next.directoryPages).toEqual({ '': null, chapters: 499, 'chapters/deep': null });
    expect(next.listingId).toBe('after');
    const removedFolder = removeProjectEntry(next, 'chapters/deep', refreshed);
    expect(removedFolder.files.some((file) => file.path.startsWith('chapters/deep'))).toBe(false);
    expect(Object.hasOwn(removedFolder.directoryPages!, 'chapters/deep')).toBe(false);
    expect(next.directoryPages!.chapters).toBe(499);
  });
  it('merges and orders pages without duplicates or dropping previously loaded branches', () => {
    const first = mergeProjectDirectory(project, {
      projectId: project.id,
      path: 'chapters',
      nextOffset: 500,
      entries: [{ path: 'chapters/z.tex', name: 'z.tex', kind: 'file' }],
    });
    const second = mergeProjectDirectory(first, {
      projectId: project.id,
      path: 'chapters',
      nextOffset: null,
      entries: [
        { path: 'chapters/a.tex', name: 'a.tex', kind: 'file' },
        { path: 'chapters/z.tex', name: 'z.tex', kind: 'file' },
      ],
    });
    expect(second.files.map((entry) => entry.path)).toEqual([
      'chapters',
      'chapters/a.tex',
      'chapters/z.tex',
      'main.tex',
    ]);
    expect(second.treeState).toBe('complete');
    expect(first.treeState).toBe('partial');
    expect(project.files).toHaveLength(2);
    expect(
      mergeProjectDirectory(project, {
        projectId: 'old-project',
        path: '',
        entries: [],
        nextOffset: null,
      }),
    ).toBe(project);
  });

  it('reveals the ancestors of known documents without treating unknown folders as empty', () => {
    const next = includeProjectFile(project, 'chapters/deep/one.tex');
    expect(next.files.map((entry) => entry.path)).toEqual([
      'chapters',
      'chapters/deep',
      'chapters/deep/one.tex',
      'main.tex',
    ]);
    expect(Object.hasOwn(next.directoryPages!, 'chapters/deep')).toBe(false);
    expect(includeProjectFile(next, 'chapters/deep/one.tex')).toBe(next);
    expect(next.treeState).toBe('partial');
  });
});
