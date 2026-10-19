/**
 * Lightweight, dependency-free extraction of document structure from LaTeX source:
 * the section outline and the files a document pulls in. It is a reading aid, not a
 * TeX engine: macro-generated commands and conditionals are intentionally not expanded.
 */

export const SECTION_LEVELS = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
} as const;
export type SectionCommand = keyof typeof SECTION_LEVELS;

export interface ParsedSection {
  command: SectionCommand;
  level: number;
  title: string;
  starred: boolean;
  /** 1-based line of the command. */
  line: number;
}

export type ReferenceKind = 'tex' | 'text' | 'bib' | 'graphic' | 'package';

export interface TexReference {
  kind: ReferenceKind;
  command: string;
  /** Target as written in the source, without extension handling. */
  target: string;
  line: number;
  /** For kind 'package': the extension a local file would carry (.sty or .cls). */
  extension?: string;
}

export interface TexStructure {
  sections: ParsedSection[];
  references: TexReference[];
  graphicsPaths: string[];
}

const TEX_INCLUDES = new Set(['input', 'include', 'subfile', 'subfileinclude']);
const TEXT_INCLUDES = new Set(['lstinputlisting', 'verbatiminput']);
const IMPORTS = new Set(['import', 'subimport']);
const PACKAGE_COMMANDS: Record<string, string> = {
  usepackage: '.sty',
  RequirePackage: '.sty',
  documentclass: '.cls',
};
const MAX_GROUP = 4000;
const MAX_BRACKET = 500;

function stripComments(source: string): string {
  return source
    .split(/\r\n|\n|\r/)
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        const character = line[i];
        if (character === '\\') i++;
        else if (character === '%') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

function maskVerbatim(text: string): string {
  return text.replace(
    /\\begin\{(verbatim\*?|lstlisting|minted|comment)\}[\s\S]*?\\end\{\1\}/g,
    (match) => match.replace(/[^\n]/g, ' '),
  );
}

function lineLocator(text: string): (index: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (index) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= index) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

function skipSpace(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

function readBracket(text: string, index: number): [string, number] | null {
  const start = skipSpace(text, index);
  if (text[start] !== '[') return null;
  let depth = 0;
  for (let i = start + 1; i < text.length && i < start + MAX_BRACKET; i++) {
    const character = text[i];
    if (character === '\\') i++;
    else if (character === '{') depth++;
    else if (character === '}') depth = Math.max(0, depth - 1);
    else if (character === ']' && depth === 0) return [text.slice(start + 1, i), i + 1];
  }
  return null;
}

function readGroup(text: string, index: number): [string, number] | null {
  const start = skipSpace(text, index);
  if (text[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < text.length && i < start + MAX_GROUP; i++) {
    const character = text[i];
    if (character === '\\') i++;
    else if (character === '{') depth++;
    else if (character === '}') {
      depth--;
      if (depth === 0) return [text.slice(start + 1, i), i + 1];
    }
  }
  return null;
}

/** Reduces a heading's TeX to readable text. */
export function cleanTitle(raw: string): string {
  let title = raw
    .replace(/\\(?:label|index|footnote|thanks)\s*\{[^{}]*\}/g, '')
    .replace(/\\\\/g, ' ')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/~/g, ' ');
  for (let pass = 0; pass < 6; pass++) {
    const next = title.replace(/\\[A-Za-z]+\*?(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g, '$1');
    if (next === title) break;
    title = next;
  }
  title = title
    .replace(/\\[A-Za-z]+\*?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title;
}

function cleanTarget(raw: string): string | null {
  const target = raw.trim().replace(/^"(.*)"$/, '$1');
  if (!target || /[\\{}#$&^~\r\n]|:\/\//.test(target)) return null;
  return target;
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map(cleanTarget)
    .filter((entry): entry is string => entry !== null);
}

export function parseTexStructure(source: string): TexStructure {
  const text = maskVerbatim(stripComments(source));
  const lineAt = lineLocator(text);
  const sections: ParsedSection[] = [];
  const references: TexReference[] = [];
  const graphicsPaths: string[] = [];
  const commandPattern = /\\([A-Za-z]+)(\*?)/g;
  let match: RegExpExecArray | null;
  while ((match = commandPattern.exec(text))) {
    const name = match[1];
    const after = match.index + match[0].length;
    const line = lineAt(match.index);
    if (name in SECTION_LEVELS) {
      const command = name as SectionCommand;
      const optional = readBracket(text, after);
      const group = readGroup(text, optional ? optional[1] : after);
      if (!group) continue;
      sections.push({
        command,
        level: SECTION_LEVELS[command],
        title: cleanTitle(group[0]) || '(untitled)',
        starred: match[2] === '*',
        line,
      });
    } else if (TEX_INCLUDES.has(name) || TEXT_INCLUDES.has(name)) {
      const optional = readBracket(text, after);
      const group = readGroup(text, optional ? optional[1] : after);
      const target = group ? cleanTarget(group[0]) : null;
      if (target)
        references.push({
          kind: TEX_INCLUDES.has(name) ? 'tex' : 'text',
          command: name,
          target,
          line,
        });
    } else if (IMPORTS.has(name)) {
      const directory = readGroup(text, after);
      const file = directory ? readGroup(text, directory[1]) : null;
      const base = directory ? cleanTarget(directory[0]) : null;
      const leaf = file ? cleanTarget(file[0]) : null;
      if (base && leaf)
        references.push({
          kind: 'tex',
          command: name,
          target: `${base.replace(/\/+$/, '')}/${leaf}`,
          line,
        });
    } else if (name === 'bibliography' || name === 'addbibresource') {
      const optional = readBracket(text, after);
      const group = readGroup(text, optional ? optional[1] : after);
      if (group)
        for (const target of splitList(group[0]))
          references.push({ kind: 'bib', command: name, target, line });
    } else if (name === 'includegraphics') {
      let position = after;
      for (let i = 0; i < 2; i++) {
        const optional = readBracket(text, position);
        if (optional) position = optional[1];
      }
      const group = readGroup(text, position);
      const target = group ? cleanTarget(group[0]) : null;
      if (target) references.push({ kind: 'graphic', command: name, target, line });
    } else if (name === 'graphicspath') {
      const group = readGroup(text, after);
      if (group) {
        let position = 0;
        for (;;) {
          const inner = readGroup(group[0], position);
          if (!inner) break;
          const directory = cleanTarget(inner[0]);
          if (directory) graphicsPaths.push(directory.replace(/\/+$/, ''));
          position = inner[1];
        }
      }
    } else if (name in PACKAGE_COMMANDS) {
      const optional = readBracket(text, after);
      const group = readGroup(text, optional ? optional[1] : after);
      if (group)
        for (const target of splitList(group[0]))
          references.push({
            kind: 'package',
            command: name,
            target,
            line,
            extension: PACKAGE_COMMANDS[name],
          });
    }
  }
  return { sections, references, graphicsPaths };
}

/** Lower-cased project path to the path as it exists on disk (Windows is case-insensitive). */
export type FileIndex = Map<string, string>;

export function buildFileIndex(paths: Iterable<string>): FileIndex {
  const index: FileIndex = new Map();
  for (const path of paths) index.set(path.toLowerCase(), path);
  return index;
}

export function dirnameOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

export function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Normalises a project-relative POSIX path. Returns null when it would leave the project. */
export function normalizeProjectPath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

const EXTENSIONS: Record<Exclude<ReferenceKind, 'package'>, string[]> = {
  tex: ['', '.tex'],
  text: [''],
  bib: ['.bib', ''],
  graphic: ['', '.pdf', '.png', '.jpg', '.jpeg', '.eps', '.svg'],
};

/**
 * Resolves a reference to a project file. TeX runs from the project root, but chapter files
 * often use paths relative to themselves, so both bases are tried (root first).
 */
export function resolveReference(
  reference: TexReference,
  fromPath: string,
  index: FileIndex,
  graphicsPaths: string[] = [],
): string | null {
  const fromDirectory = dirnameOf(fromPath);
  const bases = fromDirectory ? ['', fromDirectory] : [''];
  const directories: string[] = [];
  for (const base of bases) {
    directories.push(base);
    if (reference.kind === 'graphic')
      for (const graphicsPath of graphicsPaths)
        directories.push(base ? `${base}/${graphicsPath}` : graphicsPath);
  }
  const extensions =
    reference.kind === 'package' ? [reference.extension ?? '.sty'] : EXTENSIONS[reference.kind];
  for (const directory of directories)
    for (const extension of extensions) {
      const candidate = normalizeProjectPath(
        `${directory}/${reference.target}${extension}`.replace(/^\//, ''),
      );
      const found = candidate ? index.get(candidate.toLowerCase()) : undefined;
      if (found) return found;
    }
  return null;
}
