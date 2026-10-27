import {
  basenameOf,
  parseTexStructure,
  resolveReference,
  referenceCandidates,
  type FileIndex,
  type ParsedSection,
  type ReferenceKind,
  type TexStructure,
} from './tex-structure';

export interface OutlineItem extends ParsedSection {
  /** Project-relative file the heading lives in (may be an \include d chapter). */
  path: string;
}

export interface DocumentNode {
  /** Unique within one model, safe to use as a React key and a collapse key. */
  key: string;
  kind: 'root' | ReferenceKind;
  command: string;
  label: string;
  target: string;
  path: string | null;
  /** 'unchecked' means the project listing is partial, so absence proves nothing. */
  status: 'ok' | 'missing' | 'unchecked';
  line: number | null;
  /** The file includes one of its own ancestors; it is shown but not expanded again. */
  cycle: boolean;
  unreadable: boolean;
  children: DocumentNode[];
}

export interface DocumentModel {
  root: DocumentNode;
  /** Headings in reading order, with included files' headings spliced in place. */
  outline: OutlineItem[];
  /** True when the node or depth cap cut the tree short. */
  limited: boolean;
}

export interface DocumentModelOptions {
  /** Current text of a project file (unsaved edits included), or null if unreadable. */
  readSource: (path: string) => Promise<string | null>;
  /** Try a reference candidate that may legitimately not exist. */
  readCandidate?: (path: string) => Promise<string | null>;
  index: FileIndex;
  /** False when folders or directory pages are still unlisted. */
  listingComplete?: boolean;
  maxNodes?: number;
  maxDepth?: number;
}

export async function buildDocumentModel(
  rootPath: string,
  options: DocumentModelOptions,
): Promise<DocumentModel> {
  const maxNodes = options.maxNodes ?? 400;
  const maxDepth = options.maxDepth ?? 16;
  const structures = new Map<string, TexStructure | null>();
  const sources = new Map<string, string | null>();
  let count = 0;
  let limited = false;

  async function structureOf(path: string): Promise<TexStructure | null> {
    if (structures.has(path)) return structures.get(path) ?? null;
    const source = sources.has(path) ? (sources.get(path) ?? null) : await options.readSource(path);
    const structure = source === null ? null : parseTexStructure(source);
    structures.set(path, structure);
    return structure;
  }

  async function expand(
    path: string,
    chain: string[],
    depth: number,
    parentKey: string,
  ): Promise<{ children: DocumentNode[]; outline: OutlineItem[]; unreadable: boolean }> {
    const structure = await structureOf(path);
    if (!structure) return { children: [], outline: [], unreadable: true };
    const children: DocumentNode[] = [];
    const pieces: { line: number; items: OutlineItem[] }[] = structure.sections.map((section) => ({
      line: section.line,
      items: [{ ...section, path }],
    }));
    const seenLeaves = new Set<string>();
    for (const reference of structure.references) {
      if (count >= maxNodes) {
        limited = true;
        break;
      }
      let resolved = resolveReference(reference, path, options.index, structure.graphicsPaths);
      if (
        !resolved &&
        options.listingComplete === false &&
        (reference.kind === 'tex' || reference.kind === 'bib')
      ) {
        for (const candidate of referenceCandidates(reference, path, structure.graphicsPaths)) {
          if (!sources.has(candidate))
            sources.set(candidate, await (options.readCandidate ?? options.readSource)(candidate));
          if (sources.get(candidate) !== null) {
            resolved = candidate;
            break;
          }
        }
      }
      if (resolved === null && reference.kind === 'package') continue;
      if (resolved !== null && reference.kind !== 'tex') {
        if (seenLeaves.has(resolved)) continue;
        seenLeaves.add(resolved);
      }
      count++;
      const key = `${parentKey}/${children.length}:${resolved ?? reference.target}`;
      const node: DocumentNode = {
        key,
        kind: reference.kind,
        command: reference.command,
        label: resolved ? basenameOf(resolved) : reference.target,
        target: reference.target,
        path: resolved,
        status: resolved ? 'ok' : options.listingComplete === false ? 'unchecked' : 'missing',
        line: reference.line,
        cycle: false,
        unreadable: false,
        children: [],
      };
      if (reference.kind === 'tex' && resolved) {
        if (chain.includes(resolved)) node.cycle = true;
        else if (depth >= maxDepth) limited = true;
        else {
          const sub = await expand(resolved, [...chain, resolved], depth + 1, key);
          node.children = sub.children;
          node.unreadable = sub.unreadable;
          pieces.push({ line: reference.line, items: sub.outline });
        }
      }
      children.push(node);
    }
    pieces.sort((a, b) => a.line - b.line);
    return { children, outline: pieces.flatMap((piece) => piece.items), unreadable: false };
  }

  const expanded = await expand(rootPath, [rootPath], 0, 'root');
  return {
    root: {
      key: 'root',
      kind: 'root',
      command: '',
      label: basenameOf(rootPath),
      target: rootPath,
      path: rootPath,
      status: 'ok',
      line: null,
      cycle: false,
      unreadable: expanded.unreadable,
      children: expanded.children,
    },
    outline: expanded.outline,
    limited,
  };
}
