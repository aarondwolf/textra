import type { FileEntry, ProjectDirectoryPage, ProjectDirectoryRequest, ProjectInfo } from './api';

/** Order the loaded portion as a tree, with folders before sibling files. */
export function orderProjectFiles(files: Iterable<FileEntry>): FileEntry[] {
  const children = new Map<string, FileEntry[]>();
  for (const entry of files) {
    const parent = entry.path.split('/').slice(0, -1).join('/');
    const siblings = children.get(parent) ?? [];
    siblings.push(entry);
    children.set(parent, siblings);
  }
  const ordered: FileEntry[] = [];
  const visit = (parent: string) => {
    const siblings = children.get(parent) ?? [];
    siblings.sort(
      (a, b) =>
        Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
        a.name.localeCompare(b.name),
    );
    for (const entry of siblings) {
      ordered.push(entry);
      if (entry.kind === 'directory') visit(entry.path);
    }
  };
  visit('');
  return ordered;
}

export function mergeProjectDirectory(
  project: ProjectInfo,
  page: ProjectDirectoryPage,
): ProjectInfo {
  if (project.id !== page.projectId) return project;
  const files = new Map(project.files.map((file) => [file.path, file]));
  for (const entry of page.entries) files.set(entry.path, entry);
  const directoryPages = { ...project.directoryPages, [page.path]: page.nextOffset };
  const ordered = orderProjectFiles(files.values());
  const complete =
    Object.values(directoryPages).every((offset) => offset === null) &&
    ordered.every((entry) => entry.kind !== 'directory' || directoryPages[entry.path] === null);
  return {
    ...project,
    files: ordered,
    directoryPages,
    truncated: false,
    treeState: complete ? 'complete' : 'partial',
  };
}

/** A successfully opened document is known even if its parent folder is not listed yet. */
export function includeProjectFile(project: ProjectInfo, path: string): ProjectInfo {
  const files = new Map(project.files.map((file) => [file.path, file]));
  let changed = false;
  const parts = path.split('/');
  parts.forEach((name, index) => {
    const entryPath = parts.slice(0, index + 1).join('/');
    if (files.has(entryPath)) return;
    changed = true;
    files.set(entryPath, {
      path: entryPath,
      name,
      kind: index === parts.length - 1 ? 'file' : 'directory',
    });
  });
  return changed
    ? { ...project, files: orderProjectFiles(files.values()), treeState: 'partial' }
    : project;
}

/** Refresh previously loaded pages offscreen, then publish one complete visible snapshot. */
export async function refreshLoadedProjectTree(
  previous: ProjectInfo,
  root: ProjectInfo,
  read: (request: ProjectDirectoryRequest) => Promise<ProjectDirectoryPage | null>,
): Promise<ProjectInfo> {
  if (previous.id !== root.id) return root;
  const files = new Map(root.files.map((file) => [file.path, file]));
  const directoryPages = new Map<string, number | null>(Object.entries(root.directoryPages ?? {}));
  const paths = [...new Set(['', ...Object.keys(previous.directoryPages ?? {})])];
  for (let start = 0; start < paths.length; start += 4) {
    await Promise.all(
      paths.slice(start, start + 4).map(async (path) => {
        const desired =
          previous.directoryPages?.[path] ??
          previous.files.filter((file) => file.path.split('/').slice(0, -1).join('/') === path)
            .length;
        let page: ProjectDirectoryPage | null =
          path === ''
            ? {
                projectId: root.id,
                path,
                entries: root.files,
                nextOffset: root.directoryPages?.[''] ?? null,
              }
            : await read({ projectId: root.id, path, offset: 0 });
        if (!page) return;
        const parts = path.split('/').filter(Boolean);
        parts.forEach((name, index) => {
          const parent = parts.slice(0, index + 1).join('/');
          files.set(parent, { path: parent, name, kind: 'directory' });
        });
        let loaded = 0;
        for (;;) {
          page.entries.forEach((file) => files.set(file.path, file));
          directoryPages.set(path, page.nextOffset);
          loaded = page.nextOffset ?? loaded + page.entries.length;
          if (page.nextOffset === null || loaded >= desired) break;
          page = await read({ projectId: root.id, path, offset: page.nextOffset });
          if (!page) break;
        }
      }),
    );
  }
  return mergeProjectDirectory(
    {
      ...root,
      files: orderProjectFiles(files.values()),
      directoryPages: Object.fromEntries(directoryPages),
    },
    { projectId: root.id, path: '', entries: [], nextOffset: directoryPages.get('') ?? null },
  );
}

/** Apply a confirmed deletion without throwing away expanded folders or loaded pages. */
export function removeProjectEntry(
  project: ProjectInfo,
  path: string,
  refreshed: ProjectInfo,
): ProjectInfo {
  if (project.id !== refreshed.id) return project;
  const removed = (candidate: string) => candidate === path || candidate.startsWith(`${path}/`);
  const parent = path.split('/').slice(0, -1).join('/');
  const directoryPages = Object.fromEntries(
    Object.entries(project.directoryPages ?? {}).filter(([directory]) => !removed(directory)),
  );
  const offset = directoryPages[parent];
  if (typeof offset === 'number' && project.files.some((file) => file.path === path))
    directoryPages[parent] = Math.max(0, offset - 1);
  return {
    ...project,
    files: project.files.filter((file) => !removed(file.path)),
    directoryPages,
    listingId: refreshed.listingId,
    mainFile: project.mainFile && removed(project.mainFile) ? refreshed.mainFile : project.mainFile,
  };
}
