/**
 * AST-based extraction of document structure from LaTeX source:
 * the section outline and the files a document pulls in. It is a reading aid, not a
 * TeX engine: macro-generated commands and conditionals are intentionally not expanded.
 */

import { getParser } from '@unified-latex/unified-latex-util-parse';
import { toString } from '@unified-latex/unified-latex-util-to-string';
import { SKIP, visit } from '@unified-latex/unified-latex-util-visit';
import type * as Ast from '@unified-latex/unified-latex-types';

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

const texStructureParser = getParser({
  macros: {
    input: { signature: 'm' },
    include: { signature: 'm' },
    subfile: { signature: 'm' },
    subfileinclude: { signature: 'm' },
    lstinputlisting: { signature: 'o m' },
    verbatiminput: { signature: 'o m' },
    import: { signature: 'm m' },
    subimport: { signature: 'm m' },
    bibliography: { signature: 'o m' },
    addbibresource: { signature: 'o m' },
    includegraphics: { signature: 'o o m' },
    graphicspath: { signature: 'm' },
    usepackage: { signature: 'o m' },
    RequirePackage: { signature: 'o m' },
    documentclass: { signature: 'o m' },
  },
});

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
  let ast: Ast.Root;
  try {
    ast = texStructureParser.parse(source);
  } catch {
    return { sections: [], references: [], graphicsPaths: [] };
  }

  const sections: ParsedSection[] = [];
  const references: TexReference[] = [];
  const graphicsPaths: string[] = [];

  visit(ast, {
    enter(node) {
      if (
        node.type === 'verbatim' ||
        (node.type === 'environment' && /^(verbatim\*?|lstlisting|minted|comment)$/.test(node.env))
      ) {
        return SKIP;
      }

      if (node.type === 'macro') {
        const name = node.content;
        const line = node.position?.start?.line ?? 1;

        if (name in SECTION_LEVELS) {
          const command = name as SectionCommand;
          const starred = Boolean(
            node.args?.[0]?.content?.some((c) => c.type === 'string' && c.content === '*'),
          );
          const mandatoryArg = node.args?.find((a) => a.openMark === '{');
          if (!mandatoryArg) return;
          const title = cleanTitle(toString(mandatoryArg.content)) || '(untitled)';
          sections.push({
            command,
            level: SECTION_LEVELS[command],
            title,
            starred,
            line,
          });
        } else if (TEX_INCLUDES.has(name) || TEXT_INCLUDES.has(name)) {
          const mandatoryArg = node.args?.find((a) => a.openMark === '{');
          const target = mandatoryArg ? cleanTarget(toString(mandatoryArg.content)) : null;
          if (target) {
            references.push({
              kind: TEX_INCLUDES.has(name) ? 'tex' : 'text',
              command: name,
              target,
              line,
            });
          }
        } else if (IMPORTS.has(name)) {
          const mandatoryArgs = node.args?.filter((a) => a.openMark === '{') ?? [];
          if (mandatoryArgs.length >= 2) {
            const base = cleanTarget(toString(mandatoryArgs[0].content));
            const leaf = cleanTarget(toString(mandatoryArgs[1].content));
            if (base && leaf) {
              references.push({
                kind: 'tex',
                command: name,
                target: `${base.replace(/\/+$/, '')}/${leaf}`,
                line,
              });
            }
          }
        } else if (name === 'bibliography' || name === 'addbibresource') {
          const mandatoryArg = node.args?.find((a) => a.openMark === '{');
          if (mandatoryArg) {
            for (const target of splitList(toString(mandatoryArg.content))) {
              references.push({ kind: 'bib', command: name, target, line });
            }
          }
        } else if (name === 'includegraphics') {
          const mandatoryArg = node.args?.find((a) => a.openMark === '{');
          const target = mandatoryArg ? cleanTarget(toString(mandatoryArg.content)) : null;
          if (target) references.push({ kind: 'graphic', command: name, target, line });
        } else if (name === 'graphicspath') {
          const mandatoryArg = node.args?.find((a) => a.openMark === '{');
          if (mandatoryArg) {
            const groups = mandatoryArg.content.filter((n) => n.type === 'group');
            if (groups.length > 0) {
              for (const g of groups) {
                const directory = cleanTarget(toString((g as Ast.Group).content));
                if (directory) graphicsPaths.push(directory.replace(/\/+$/, ''));
              }
            } else {
              for (const part of splitList(toString(mandatoryArg.content))) {
                graphicsPaths.push(part.replace(/\/+$/, ''));
              }
            }
          }
        } else if (name in PACKAGE_COMMANDS) {
          const mandatoryArg = node.args?.find((a) => a.openMark === '{');
          if (mandatoryArg) {
            for (const target of splitList(toString(mandatoryArg.content))) {
              references.push({
                kind: 'package',
                command: name,
                target,
                line,
                extension: PACKAGE_COMMANDS[name],
              });
            }
          }
        }
      }
    },
  });

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
