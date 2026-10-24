/**
 * Lightweight document intelligence for LaTeX source. This deliberately does not
 * expand macros: it gives predictable, useful results for ordinary handwritten TeX
 * while remaining safe to run on every editor change.
 */

import { getParser } from '@unified-latex/unified-latex-util-parse';
import { toString } from '@unified-latex/unified-latex-util-to-string';
import { SKIP, visit } from '@unified-latex/unified-latex-util-visit';
import type * as Ast from '@unified-latex/unified-latex-types';

export type OutlineCommand =
  'part' | 'chapter' | 'section' | 'subsection' | 'subsubsection' | 'paragraph' | 'subparagraph';

export interface SourceOccurrence {
  value: string;
  command: string;
  line: number;
  column: number;
}

export interface WritingOutlineItem {
  command: OutlineCommand;
  level: number;
  title: string;
  starred: boolean;
  line: number;
}

export interface WritingCounts {
  words: number;
  sections: number;
  tables: number;
  figures: number;
  equations: number;
  citations: number;
  todos: number;
}

export interface TodoItem {
  kind: 'TODO' | 'FIXME';
  text: string;
  line: number;
  column: number;
}

export interface ReferenceIssue {
  kind: 'duplicate-label' | 'missing-label';
  value: string;
  occurrences: SourceOccurrence[];
}

export interface WritingAnalysis {
  outline: WritingOutlineItem[];
  labels: SourceOccurrence[];
  references: SourceOccurrence[];
  citations: SourceOccurrence[];
  graphics: SourceOccurrence[];
  todos: TodoItem[];
  counts: WritingCounts;
  referenceIssues: ReferenceIssue[];
}

export interface PromptContext {
  /** 1-based, inclusive source lines. */
  startLine: number;
  /** 1-based, inclusive source lines. */
  endLine: number;
  text: string;
  /** The environment used to select the context, when one contains the target. */
  environment: string | null;
}

const SECTION_LEVELS: Record<OutlineCommand, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};
const SECTION_NAMES = new Set<OutlineCommand>(Object.keys(SECTION_LEVELS) as OutlineCommand[]);
const VERBATIM_ENVIRONMENTS = new Set(['verbatim', 'verbatim*', 'lstlisting', 'minted', 'comment']);
const TABLE_ENVIRONMENTS = new Set([
  'table',
  'table*',
  'tabular',
  'tabular*',
  'longtable',
  'tabularx',
  'tabulary',
]);
const FIGURE_ENVIRONMENTS = new Set(['figure', 'figure*', 'wrapfigure']);
const EQUATION_ENVIRONMENTS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'alignat',
  'alignat*',
  'flalign',
  'flalign*',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'displaymath',
  'math',
]);

const writingLatexParser = getParser({
  macros: {
    label: { signature: 'm' },
    ref: { signature: 'm' },
    eqref: { signature: 'm' },
    pageref: { signature: 'm' },
    autoref: { signature: 'm' },
    cref: { signature: 'm' },
    Cref: { signature: 'm' },
    cpageref: { signature: 'm' },
    Cpageref: { signature: 'm' },
    crefrange: { signature: 'm m' },
    Crefrange: { signature: 'm m' },
    vref: { signature: 'm' },
    Vref: { signature: 'm' },
    cite: { signature: 'o o m' },
    citep: { signature: 'o o m' },
    citet: { signature: 'o o m' },
    citeauthor: { signature: 'o o m' },
    citeyear: { signature: 'o o m' },
    autocite: { signature: 'o o m' },
    Autocite: { signature: 'o o m' },
    parencite: { signature: 'o o m' },
    Parencite: { signature: 'o o m' },
    textcite: { signature: 'o o m' },
    Textcite: { signature: 'o o m' },
    footcite: { signature: 'o o m' },
    supercite: { signature: 'o o m' },
    nocite: { signature: 'm' },
    includegraphics: { signature: 'o o m' },
  },
});

/** Removes comments while preserving offsets and line numbers. */
export function maskLatexComments(source: string): string {
  let escaped = false;
  let output = '';
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (character === '\n' || character === '\r') {
      output += character;
      escaped = false;
    } else if (character === '%' && !escaped) {
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        output += ' ';
        i++;
      }
      i--;
      escaped = false;
    } else {
      output += character;
      escaped = character === '\\' ? !escaped : false;
    }
  }
  return output;
}

function readableText(raw: string): string {
  let text = raw
    .replace(/\\(?:label|index|footnote|thanks)\s*\{[^{}]*\}/g, '')
    .replace(/\\\\/g, ' ')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/~/g, ' ');
  for (let pass = 0; pass < 6; pass++) {
    const next = text.replace(/\\[A-Za-z@]+\*?(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g, '$1');
    if (next === text) break;
    text = next;
  }
  return text
    .replace(/\\[A-Za-z@]+\*?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function valuesInGroup(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isReferenceCommand(command: string): boolean {
  return /^(?:ref|eqref|pageref|autoref|(?:[cC](?:ref|refrange))|vref|Vref)$/.test(command);
}

function isCitationCommand(command: string): boolean {
  return /cite/i.test(command) && !/^citeauthor$/.test(command);
}

function countWords(source: string): number {
  const text = source
    .replace(/\\(?:[A-Za-z@]+\*?|.)\s*(?:\[[^\]]*\])?\s*(?:\{[^{}]*\})?/g, ' ')
    .replace(/[{}~]/g, ' ')
    .replace(/[$^_&]/g, ' ');
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

function countInlineMath(source: string): number {
  const withoutEscaped = source.replace(/\\\$/g, '');
  return (
    (withoutEscaped.match(/(?<!\$)\$(?!\$)[\s\S]*?(?<!\\)\$(?!\$)/g) ?? []).length +
    (withoutEscaped.match(/\\\[[\s\S]*?\\\]/g) ?? []).length
  );
}

/** Scans one document using unified-latex AST, ignoring comments and verbatim-like environments. */
export function analyzeLatexDocument(source: string): WritingAnalysis {
  let ast: Ast.Root;
  try {
    ast = writingLatexParser.parse(source);
  } catch {
    return {
      outline: [],
      labels: [],
      references: [],
      citations: [],
      graphics: [],
      todos: [],
      referenceIssues: [],
      counts: {
        words: 0,
        sections: 0,
        tables: 0,
        figures: 0,
        equations: 0,
        citations: 0,
        todos: 0,
      },
    };
  }

  const outline: WritingOutlineItem[] = [];
  const labels: SourceOccurrence[] = [];
  const references: SourceOccurrence[] = [];
  const citations: SourceOccurrence[] = [];
  const graphics: SourceOccurrence[] = [];
  const verbatimRanges: Array<{ start: number; end: number }> = [];
  let tableCount = 0;
  let figureCount = 0;
  let equationCount = 0;

  visit(ast, {
    enter(node) {
      if (node.type === 'verbatim') {
        if (node.position?.start?.line && node.position?.end?.line) {
          verbatimRanges.push({ start: node.position.start.line, end: node.position.end.line });
        }
        return SKIP;
      }
      if (node.type === 'mathenv') {
        equationCount++;
      } else if (node.type === 'environment') {
        const envName = (node as { env?: string }).env ?? '';
        if (VERBATIM_ENVIRONMENTS.has(envName)) {
          if (node.position?.start?.line && node.position?.end?.line) {
            verbatimRanges.push({ start: node.position.start.line, end: node.position.end.line });
          }
          return SKIP;
        }
        if (TABLE_ENVIRONMENTS.has(envName)) tableCount++;
        if (FIGURE_ENVIRONMENTS.has(envName)) figureCount++;
        if (EQUATION_ENVIRONMENTS.has(envName)) equationCount++;
      } else if (node.type === 'inlinemath' || node.type === 'displaymath') {
        equationCount++;
      } else if (node.type === 'macro') {
        const command = node.content;
        const line = node.position?.start?.line ?? 1;
        const column = node.position?.start?.column ?? 1;

        if (SECTION_NAMES.has(command as OutlineCommand)) {
          const starred = Boolean(
            node.args?.[0]?.content?.some((c) => c.type === 'string' && c.content === '*'),
          );
          const mandatoryArg = node.args?.find((a) => a.openMark === '{');
          if (mandatoryArg) {
            outline.push({
              command: command as OutlineCommand,
              level: SECTION_LEVELS[command as OutlineCommand],
              title: readableText(toString(mandatoryArg.content)) || '(untitled)',
              starred,
              line,
            });
          }
        } else if (command === 'label') {
          const mandatoryArg = node.args?.find((a) => a.openMark === '{');
          if (mandatoryArg) {
            for (const value of valuesInGroup(toString(mandatoryArg.content))) {
              labels.push({ value, command, line, column });
            }
          }
        } else if (isReferenceCommand(command)) {
          const mandatoryArg = node.args?.find((a) => a.openMark === '{');
          if (mandatoryArg) {
            for (const value of valuesInGroup(toString(mandatoryArg.content))) {
              references.push({ value, command, line, column });
            }
          }
        } else if (isCitationCommand(command)) {
          const mandatoryArg = node.args?.find((a) => a.openMark === '{');
          if (mandatoryArg) {
            for (const value of valuesInGroup(toString(mandatoryArg.content))) {
              citations.push({ value, command, line, column });
            }
          }
        } else if (command === 'includegraphics') {
          const mandatoryArg = node.args?.find((a) => a.openMark === '{');
          if (mandatoryArg) {
            for (const value of valuesInGroup(toString(mandatoryArg.content))) {
              graphics.push({ value, command, line, column });
            }
          }
        }
      }
    },
  });

  const sourceLines = source.split(/\r?\n/);
  const todos: TodoItem[] = [];
  for (let i = 0; i < sourceLines.length; i++) {
    const lineNum = i + 1;
    if (verbatimRanges.some((r) => lineNum >= r.start && lineNum <= r.end)) continue;
    const lineText = sourceLines[i];
    const match = /\b(TODO|FIXME)\b\s*:?[ \t]*([^\r\n]*)/.exec(lineText);
    if (match) {
      todos.push({
        kind: match[1] as TodoItem['kind'],
        text: match[2].trim(),
        line: lineNum,
        column: match.index + 1,
      });
    }
  }

  const referenceIssues = findReferenceIssues(labels, references);
  return {
    outline,
    labels,
    references,
    citations,
    graphics,
    todos,
    referenceIssues,
    counts: {
      words: countWords(source),
      sections: outline.length,
      tables: tableCount,
      figures: figureCount || graphics.length,
      equations: equationCount,
      citations: citations.length,
      todos: todos.length,
    },
  };
}

/** Lightweight outline and statistics extraction for Markdown documents. */
export function analyzeMarkdownDocument(source: string): WritingAnalysis {
  const outline: WritingOutlineItem[] = [];
  const todos: TodoItem[] = [];
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    // Match ATX headers: '# Header', '## Subheader', etc.
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(lineText);
    if (headingMatch) {
      const hashes = headingMatch[1].length;
      const title = headingMatch[2].trim().replace(/\s+#+$/, '');
      const command: OutlineCommand =
        hashes === 1
          ? 'section'
          : hashes === 2
            ? 'subsection'
            : hashes === 3
              ? 'subsubsection'
              : hashes === 4
                ? 'paragraph'
                : 'subparagraph';
      outline.push({
        command,
        level: hashes,
        title: title || '(untitled)',
        starred: false,
        line: i + 1,
      });
    }

    // Match TODO and FIXME annotations
    const todoMatch = /\b(TODO|FIXME)\b\s*:?[ \t]*([^\r\n]*)/.exec(lineText);
    if (todoMatch) {
      todos.push({
        kind: todoMatch[1] as TodoItem['kind'],
        text: todoMatch[2].trim(),
        line: i + 1,
        column: todoMatch.index + 1,
      });
    }
  }

  const tableRows = (source.match(/^\|.+?\|$/gm) ?? []).length;
  const imageCount = (source.match(/!\[.*?\]\(.*?\)/g) ?? []).length;

  return {
    outline,
    labels: [],
    references: [],
    citations: [],
    graphics: [],
    todos,
    referenceIssues: [],
    counts: {
      words: countWords(source),
      sections: outline.length,
      tables: tableRows ? 1 : 0,
      figures: imageCount,
      equations: countInlineMath(source),
      citations: 0,
      todos: todos.length,
    },
  };
}

/** Finds duplicate labels and references whose target is absent from this document. */
export function findReferenceIssues(
  labels: readonly SourceOccurrence[],
  references: readonly SourceOccurrence[],
): ReferenceIssue[] {
  const labelsByValue = new Map<string, SourceOccurrence[]>();
  for (const label of labels)
    labelsByValue.set(label.value, [...(labelsByValue.get(label.value) ?? []), label]);
  const issues: ReferenceIssue[] = [];
  for (const [value, occurrences] of labelsByValue) {
    if (occurrences.length > 1) issues.push({ kind: 'duplicate-label', value, occurrences });
  }
  const missing = new Map<string, SourceOccurrence[]>();
  for (const reference of references) {
    if (!labelsByValue.has(reference.value))
      missing.set(reference.value, [...(missing.get(reference.value) ?? []), reference]);
  }
  for (const [value, occurrences] of missing)
    issues.push({ kind: 'missing-label', value, occurrences });
  return issues;
}

/**
 * Returns a useful excerpt for a diagnostic. A matching surrounding environment
 * wins, otherwise the excerpt spans `radius` lines either side of the target.
 */
export function extractPromptContext(
  source: string,
  targetLine: number,
  radius = 100,
): PromptContext {
  const lines = source.split(/\r\n|\n|\r/);
  const line = Math.max(1, Math.min(targetLine, Math.max(lines.length, 1)));

  let ast: Ast.Root | null = null;
  try {
    ast = writingLatexParser.parse(source);
  } catch {
    // AST parse fallback
  }

  let nearest: { name: string; start: number; end: number } | null = null;
  if (ast) {
    visit(ast, {
      enter(node) {
        if (node.type === 'verbatim') return SKIP;
        if (node.type === 'environment') {
          const envName = (node as { env?: string }).env ?? '';
          if (VERBATIM_ENVIRONMENTS.has(envName)) return SKIP;
          const start = node.position?.start?.line;
          const end = node.position?.end?.line;
          if (start && end && start <= line && line <= end) {
            if (!nearest || end - start < nearest.end - nearest.start) {
              nearest = { name: envName, start, end };
            }
          }
        }
      },
    });
  }

  const enclosing = nearest as { name: string; start: number; end: number } | null;
  if (enclosing) {
    return {
      startLine: enclosing.start,
      endLine: enclosing.end,
      text: lines.slice(enclosing.start - 1, enclosing.end).join('\n'),
      environment: enclosing.name,
    };
  }
  const startLine = Math.max(1, line - Math.max(0, radius));
  const endLine = Math.min(lines.length, line + Math.max(0, radius));
  return {
    startLine,
    endLine,
    text: lines.slice(startLine - 1, endLine).join('\n'),
    environment: null,
  };
}

export interface OutlineHeadingRef {
  line: number;
  level: number;
}

/**
 * Computes the 0-based inclusive line range [startLine, endLine] of a section in LaTeX source.
 * A section includes its body and any child subsections up until the next section
 * of equal or higher hierarchy (level <= current), \end{document}, or end of file.
 */
export function computeOutlineSectionRange(
  outline: OutlineHeadingRef[],
  index: number,
  totalLines: number,
  lines?: string[],
): { startLine: number; endLine: number } | null {
  if (index < 0 || index >= outline.length) return null;
  const item = outline[index];
  const startLine = Math.max(0, item.line - 1);
  if (startLine >= totalLines) return null;

  let nextBoundaryLine = totalLines;
  for (let j = index + 1; j < outline.length; j++) {
    if (outline[j].level <= item.level) {
      nextBoundaryLine = Math.max(startLine, outline[j].line - 1);
      break;
    }
  }

  if (lines) {
    for (let l = startLine; l < nextBoundaryLine; l++) {
      if (/^\s*\\end\{document\}/i.test(lines[l])) {
        nextBoundaryLine = l;
        break;
      }
    }
  }

  const endLine = Math.max(startLine, nextBoundaryLine - 1);
  return { startLine, endLine };
}

/**
 * Reorders a section (and all its nested subsections) in LaTeX source based on
 * outline indices, preserving line endings and whitespace.
 */
export function moveSectionInLatex(
  source: string,
  fromIndex: number,
  toIndex: number,
  position: 'before' | 'after',
  outline: OutlineHeadingRef[],
): string {
  if (fromIndex === toIndex) return source;
  if (fromIndex < 0 || fromIndex >= outline.length) return source;
  if (toIndex < 0 || toIndex >= outline.length) return source;

  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r\n|\n/);

  const sourceRange = computeOutlineSectionRange(outline, fromIndex, lines.length, lines);
  const targetRange = computeOutlineSectionRange(outline, toIndex, lines.length, lines);
  if (!sourceRange || !targetRange) return source;

  // Cannot move a parent section into itself or one of its child subsections
  const targetStart = targetRange.startLine;
  if (targetStart >= sourceRange.startLine && targetStart <= sourceRange.endLine) {
    return source;
  }

  const movingCount = sourceRange.endLine - sourceRange.startLine + 1;
  const movingLines = lines.slice(sourceRange.startLine, sourceRange.endLine + 1);

  const remaining = [
    ...lines.slice(0, sourceRange.startLine),
    ...lines.slice(sourceRange.endLine + 1),
  ];

  const targetOriginalInsertPoint =
    position === 'before' ? targetRange.startLine : targetRange.endLine + 1;

  let insertIndex: number;
  if (targetOriginalInsertPoint <= sourceRange.startLine) {
    insertIndex = targetOriginalInsertPoint;
  } else if (targetOriginalInsertPoint > sourceRange.endLine) {
    insertIndex = targetOriginalInsertPoint - movingCount;
  } else {
    return source;
  }

  insertIndex = Math.max(0, Math.min(insertIndex, remaining.length));
  const endDocIndex = remaining.findIndex((l) => /^\s*\\end\{document\}/i.test(l));
  if (endDocIndex !== -1 && insertIndex > endDocIndex) {
    insertIndex = endDocIndex;
  }
  remaining.splice(insertIndex, 0, ...movingLines);

  return remaining.join(newline);
}
