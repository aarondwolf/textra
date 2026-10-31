import { parseMinimal } from '@unified-latex/unified-latex-util-parse';
import { diffChars } from 'diff';
import {
  DEFAULT_VISUAL_IGNORED_COMMANDS,
  DEFAULT_VISUAL_IGNORED_ENVIRONMENTS,
} from '../../../../shared/api';

/** The adapter works in LF-normalized UTF-16 offsets, like the renderer's editor bridge. */
export interface VisualNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: VisualNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}
export interface SourceEdit {
  from: number;
  to: number;
  insert: string;
}
export interface SourceRange {
  from: number;
  to: number;
}
export interface VisualImportOptions {
  ignoredCommands?: readonly string[];
  ignoredEnvironments?: readonly string[];
}
export interface VisualBlock extends SourceRange {
  id: string;
  node: VisualNode;
}
export interface Projection {
  source: string;
  doc: VisualNode;
  blocks: VisualBlock[];
  ranges: Record<string, SourceRange>;
}
export type ProjectionChange =
  { ok: true; edits: SourceEdit[]; nextProjection: Projection } | { ok: false; error: string };

interface ParsedNode {
  type: string;
  content?: string | ParsedNode[];
  env?: string;
  sameline?: boolean;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

const headings: Record<string, number> = {
  part: 1,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};
const marks: Record<string, string> = {
  textbf: 'bold',
  textit: 'italic',
  emph: 'italic',
  texttt: 'code',
  underline: 'underline',
  textsc: 'smallCaps',
  textsuperscript: 'superscript',
  textsubscript: 'subscript',
};
const markCommands: Record<string, string> = {
  bold: 'textbf',
  italic: 'textit',
  code: 'texttt',
  underline: 'underline',
  smallCaps: 'textsc',
  superscript: 'textsuperscript',
  subscript: 'textsubscript',
};
const symbolCommands: Record<string, string> = {
  LaTeX: 'LaTeX',
  TeX: 'TeX',
  textemdash: '—',
  textendash: '–',
  textcopyright: '©',
  textregistered: '®',
  texttrademark: '™',
  textbullet: '•',
  textellipsis: '…',
  dots: '…',
  ldots: '…',
  pounds: '£',
  textsterling: '£',
  texteuro: '€',
  textdegree: '°',
  textsection: '§',
  textparagraph: '¶',
  textquotedbl: '"',
  textquoteleft: '‘',
  textquoteright: '’',
  textquotedblleft: '“',
  textquotedblright: '”',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  aa: 'å',
  AA: 'Å',
  o: 'ø',
  O: 'Ø',
  ss: 'ß',
  l: 'ł',
  L: 'Ł',
  i: 'ı',
  j: 'ȷ',
};
const accentCommands: Record<string, string> = {
  "'": '\u0301',
  '`': '\u0300',
  '"': '\u0308',
  '^': '\u0302',
  '~': '\u0303',
  c: '\u0327',
  '=': '\u0304',
  v: '\u030c',
  u: '\u0306',
  H: '\u030b',
  r: '\u030a',
  '.': '\u0307',
};
const referenceCommands = new Set([
  'ref',
  'eqref',
  'pageref',
  'autoref',
  'autopageref',
  'nameref',
  'vref',
  'vpageref',
  'cref',
  'cpageref',
  'crefrange',
  'cpagerefrange',
  'vrefrange',
  'vpagerefrange',
]);
const citationCommands = new Set([
  'cite',
  'citep',
  'citet',
  'citealt',
  'citealp',
  'citeauthor',
  'citeyear',
  'citeyearpar',
  'parencite',
  'textcite',
  'autocite',
  'footcite',
  'smartcite',
  'supercite',
  'fullcite',
  'nocite',
]);
const twoArgumentReferences = new Set(['crefrange', 'cpagerefrange', 'vrefrange', 'vpagerefrange']);
const otherKnownCommands = new Set([
  'label',
  'footnote',
  'input',
  'include',
  'subfile',
  'subfileinclude',
  'href',
  'url',
]);
function isProseGlyph(node: VisualNode): boolean {
  return (
    node.type === 'opaqueInline' &&
    (node.attrs?.raw === '~' ||
      (typeof node.attrs?.visualText === 'string' && node.attrs.visualText.length > 0))
  );
}
const escapes: Record<string, string> = {
  '%': '%',
  $: '$',
  '&': '&',
  '#': '#',
  _: '_',
  '{': '{',
  '}': '}',
  ' ': ' ',
  textbackslash: '\\',
  textasciitilde: '~',
  textasciicircum: '^',
};
const escapeText = (text: string) =>
  text.replace(
    /[\\%$&#_{}~^]/g,
    (char) =>
      ({
        '\\': '\\textbackslash{}',
        '%': '\\%',
        $: '\\$',
        '&': '\\&',
        '#': '\\#',
        _: '\\_',
        '{': '\\{',
        '}': '\\}',
        '~': '\\textasciitilde{}',
        '^': '\\textasciicircum{}',
      })[char]!,
  );

function bounds(node: ParsedNode | undefined, source: string): SourceRange | null {
  const from = node?.position?.start?.offset;
  const to = node?.position?.end?.offset;
  if (
    typeof from !== 'number' ||
    typeof to !== 'number' ||
    from < 0 ||
    to < from ||
    to > source.length
  )
    return null;
  return { from, to };
}
function commentBounds(node: ParsedNode, source: string): SourceRange | null {
  const range = bounds(node, source);
  if (!range) return null;
  return node.type === 'comment' && source[range.to] === '\n'
    ? { from: range.from, to: range.to + 1 }
    : range;
}
function idOf(node: VisualNode): string | undefined {
  return typeof node.attrs?.sourceId === 'string' ? node.attrs.sourceId : undefined;
}
function children(node: ParsedNode): ParsedNode[] {
  return Array.isArray(node.content) ? node.content : [];
}
function environmentName(node: ParsedNode): string | undefined {
  return typeof node.env === 'string'
    ? node.env
    : (node.env as unknown as { content?: string } | undefined)?.content;
}

/** Remove equation metadata for rendering only; the original source is never changed. */
function mathForDisplay(latex: string): string | null {
  try {
    const ast = parseMinimal(latex) as unknown as ParsedNode;
    const removals: SourceRange[] = [];
    const walk = (nodes: ParsedNode[]): boolean => {
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index];
        const span = bounds(node, latex);
        if (!span) return false;
        if (
          node.type === 'macro' &&
          typeof node.content === 'string' &&
          ['label', 'tag', 'notag', 'nonumber'].includes(node.content)
        ) {
          let end = span.to;
          if (node.content === 'label' || node.content === 'tag') {
            let nextIndex = index + 1;
            let next = nodes[nextIndex];
            let nextSpan = bounds(next, latex);
            if (
              node.content === 'tag' &&
              nextSpan?.from === end &&
              latex.slice(nextSpan.from, nextSpan.to) === '*'
            ) {
              end = nextSpan.to;
              next = nodes[++nextIndex];
              nextSpan = bounds(next, latex);
            }
            if (next?.type === 'whitespace' && nextSpan?.from === end) {
              end = nextSpan.to;
              next = nodes[++nextIndex];
              nextSpan = bounds(next, latex);
            }
            if (
              next?.type !== 'group' ||
              !nextSpan ||
              nextSpan.from !== end ||
              latex[nextSpan.from] !== '{' ||
              latex[nextSpan.to - 1] !== '}'
            )
              return false;
            end = nextSpan.to;
            index = nextIndex;
          }
          removals.push({ from: span.from, to: end });
        } else if (node.type !== 'comment' && Array.isArray(node.content) && !walk(node.content))
          return false;
      }
      return true;
    };
    if (!walk(children(ast))) return null;
    // Whitespace is ignored in math, but prevents removing a label from joining
    // a preceding control word with following letters (\alpha\label{x}b).
    return removals
      .sort((a, b) => b.from - a.from)
      .reduce((value, range) => value.slice(0, range.from) + ' ' + value.slice(range.to), latex);
  } catch {
    return null;
  }
}
interface GlyphMatch {
  from: number;
  to: number;
  text: string;
  last: number;
  remainder?: string;
  remainderFrom?: number;
  remainderTo?: number;
}
/** Recognize only fixed, conventional text symbols and simple accents. */
function proseGlyph(nodes: ParsedNode[], index: number, source: string): GlyphMatch | null {
  const node = nodes[index];
  const span = bounds(node, source);
  if (!span || node?.type !== 'macro' || typeof node.content !== 'string') return null;
  const name = node.content;
  if (Object.hasOwn(symbolCommands, name)) {
    let to = span.to;
    let last = index;
    const next = nodes[index + 1];
    const nextSpan = bounds(next, source);
    if (
      nextSpan?.from === to &&
      next?.type === 'group' &&
      source.slice(nextSpan.from, nextSpan.to) === '{}'
    ) {
      to = nextSpan.to;
      last++;
    } else if (nextSpan?.from === to && next?.type === 'whitespace') {
      // TeX ignores whitespace following a control word. Keep it with the symbol.
      to = nextSpan.to;
      last++;
    }
    return { from: span.from, to, text: symbolCommands[name], last };
  }
  const combining = accentCommands[name];
  if (!combining) return null;
  let nextIndex = index + 1;
  let next = nodes[nextIndex];
  let nextSpan = bounds(next, source);
  if (/^[A-Za-z]$/.test(name) && next?.type === 'whitespace' && nextSpan?.from === span.to) {
    next = nodes[++nextIndex];
    nextSpan = bounds(next, source);
  }
  if (!next || !nextSpan) return null;
  let base: string;
  let to = nextSpan.to;
  let remainder = '';
  let remainderFrom: number | undefined;
  let remainderTo: number | undefined;
  if (next.type === 'group' && source[nextSpan.from] === '{' && source[nextSpan.to - 1] === '}') {
    const group = children(next);
    if (group.length !== 1) return null;
    if (
      group[0].type === 'string' &&
      typeof group[0].content === 'string' &&
      [...group[0].content].length === 1
    )
      base = group[0].content;
    else if (group[0].type === 'macro' && (group[0].content === 'i' || group[0].content === 'j'))
      base = group[0].content;
    else return null;
  } else if (next.type === 'string' && typeof next.content === 'string') {
    base = [...next.content][0] ?? '';
    if (!base) return null;
    to = nextSpan.from + base.length;
    remainder = source.slice(to, nextSpan.to);
    if (remainder) {
      remainderFrom = to;
      remainderTo = nextSpan.to;
    }
  } else return null;
  const text = (base + combining).normalize('NFC');
  return {
    from: span.from,
    to,
    text,
    last: nextIndex,
    ...(remainder ? { remainder, remainderFrom, remainderTo } : {}),
  };
}
/** Derive a readable link label only from supported text and formatting. */
function linkText(nodes: ParsedNode[], source: string): string | null {
  let output = '';
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const span = bounds(node, source);
    if (!span) return null;
    if (node.type === 'string') output += source.slice(span.from, span.to);
    else if (node.type === 'whitespace') output += ' ';
    else if (node.type === 'macro' && typeof node.content === 'string') {
      const glyph = proseGlyph(nodes, index, source);
      if (glyph) {
        output += glyph.text + (glyph.remainder ?? '');
        index = glyph.last;
      } else if (Object.hasOwn(escapes, node.content)) output += escapes[node.content];
      else if (Object.hasOwn(marks, node.content) && nodes[index + 1]?.type === 'group') {
        const text = linkText(children(nodes[index + 1]), source);
        if (text === null) return null;
        output += text;
        index++;
      } else return null;
    } else return null;
  }
  return output;
}
function textNode(text: string, active: VisualNode['marks'] = []): VisualNode {
  return { type: 'text', text, ...(active.length ? { marks: active } : {}) };
}
function addText(out: VisualNode[], text: string, active: VisualNode['marks'] = []): void {
  if (!text) return;
  const previous = out[out.length - 1];
  if (previous?.type === 'text' && JSON.stringify(previous.marks ?? []) === JSON.stringify(active))
    previous.text = (previous.text ?? '') + text;
  else out.push(textNode(text, active));
}

class Importer {
  private next = 0;
  private readonly ignoredCommands: Set<string>;
  private readonly ignoredEnvironments: Set<string>;
  readonly ranges: Record<string, SourceRange> = Object.create(null) as Record<string, SourceRange>;
  constructor(
    readonly source: string,
    options: VisualImportOptions = {},
  ) {
    this.ignoredCommands = new Set(options.ignoredCommands ?? DEFAULT_VISUAL_IGNORED_COMMANDS);
    this.ignoredEnvironments = new Set(
      options.ignoredEnvironments ?? DEFAULT_VISUAL_IGNORED_ENVIRONMENTS,
    );
  }
  id(range?: SourceRange): string {
    const id = `s${this.next++}`;
    if (range) this.ranges[id] = range;
    return id;
  }
  opaque(range: SourceRange, label: string, block = false, hidden = false): VisualNode {
    return {
      type: block ? 'opaqueBlock' : 'opaqueInline',
      attrs: {
        sourceId: this.id(range),
        raw: this.source.slice(range.from, range.to),
        label,
        ...(hidden ? { hidden: true } : {}),
      },
    };
  }
  math(node: ParsedNode, block: boolean): VisualNode | null {
    const range = bounds(node, this.source);
    if (!range) return null;
    const raw = this.source.slice(range.from, range.to);
    const open = raw.startsWith('$$')
      ? '$$'
      : raw.startsWith('\\(')
        ? '\\('
        : raw.startsWith('\\[')
          ? '\\['
          : '$';
    const close = open === '\\(' ? '\\)' : open === '\\[' ? '\\]' : open;
    if (!raw.endsWith(close) || raw.length < open.length + close.length) return null;
    const latex = raw.slice(open.length, -close.length);
    const renderLatex = mathForDisplay(latex);
    if (renderLatex === null) return null;
    return {
      type: block ? 'blockMath' : 'inlineMath',
      attrs: {
        sourceId: this.id(range),
        raw,
        open,
        close,
        latex,
        renderLatex,
      },
    };
  }
  equation(node: ParsedNode): VisualNode | null {
    const env = environmentName(node);
    if (
      (node.type !== 'environment' && node.type !== 'mathenv') ||
      !env ||
      ![
        'math',
        'displaymath',
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
        'eqnarray',
        'eqnarray*',
      ].includes(env)
    )
      return null;
    const range = bounds(node, this.source);
    if (!range) return null;
    const raw = this.source.slice(range.from, range.to);
    let open = `\\begin{${env}}`;
    const close = `\\end{${env}}`;
    if (!raw.startsWith(open) || !raw.endsWith(close)) return null;
    let latex = raw.slice(open.length, -close.length);
    let alignColumns = '';
    if (env === 'alignat' || env === 'alignat*') {
      const argument = /^(\s*\{\s*([1-9]\d{0,2})\s*\})/.exec(latex);
      if (!argument) return null;
      open += argument[1];
      alignColumns = argument[2];
      latex = latex.slice(argument[1].length);
    }
    const stripped = mathForDisplay(latex);
    if (stripped === null) return null;
    const multiline = /^(?:align|flalign|eqnarray)/.test(env)
      ? 'aligned'
      : /^(?:gather|multline)/.test(env)
        ? 'gathered'
        : null;
    const renderLatex = env.startsWith('alignat')
      ? `\\begin{alignedat}{${alignColumns}}${stripped}\\end{alignedat}`
      : multiline
        ? `\\begin{${multiline}}${stripped}\\end{${multiline}}`
        : stripped;
    return {
      type: env === 'math' ? 'inlineMath' : 'blockMath',
      attrs: { sourceId: this.id(range), raw, open, close, latex, renderLatex },
    };
  }
  /** Gather only balanced, immediately attached arguments. Never guess macro expansion. */
  macroEnd(nodes: ParsedNode[], index: number, requiredGroups = 1): number {
    const initial = bounds(nodes[index], this.source);
    if (!initial) return index;
    let i = index;
    let end = initial.to;
    let groups = 0;
    while (i + 1 < nodes.length) {
      const next = nodes[i + 1];
      const range = bounds(next, this.source);
      if (!range || range.from !== end) break;
      if (next.type === 'whitespace') {
        const following = nodes[i + 2];
        const followingRange = bounds(following, this.source);
        if (
          followingRange?.from === range.to &&
          (following?.type === 'group' || this.source[followingRange.from] === '[')
        ) {
          i++;
          end = range.to;
          continue;
        }
        break;
      }
      if (i === index && this.source.slice(range.from, range.to) === '*') {
        i++;
        end = range.to;
        continue;
      }
      if (next.type === 'group') {
        i++;
        end = range.to;
        groups++;
        if (groups === requiredGroups) break;
        continue;
      }
      if (this.source[range.from] === '[') {
        let j = i + 1;
        let depth = 0;
        let last = end;
        for (; j < nodes.length; j++) {
          const part = bounds(nodes[j], this.source);
          if (!part || (part.from !== last && j !== i + 1)) break;
          const raw = this.source.slice(part.from, part.to);
          for (const ch of raw) {
            if (ch === '[') depth++;
            if (ch === ']') depth--;
          }
          last = part.to;
          if (depth === 0) break;
        }
        if (depth !== 0 || j >= nodes.length) break;
        i = j;
        end = last;
        continue;
      }
      break;
    }
    return i;
  }
  inline(nodes: ParsedNode[], active: VisualNode['marks'] = []): VisualNode[] | null {
    const out: VisualNode[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const range = bounds(node, this.source);
      if (!range) return null;
      const raw = this.source.slice(range.from, range.to);
      if (node.type === 'string') {
        // Unmatched delimiters are not safe to reinterpret as ordinary prose.
        if (raw === '~') {
          const space = this.opaque(range, 'Nonbreaking space');
          if (active.length) space.marks = active;
          out.push(space);
        } else if (/[{}$~&_^#]/.test(raw)) out.push(this.opaque(range, 'LaTeX'));
        else addText(out, raw, active);
      } else if (node.type === 'whitespace') addText(out, ' ', active);
      else if (node.type === 'comment')
        out.push(
          this.opaque(
            commentBounds(node, this.source) ?? range,
            node.sameline === false ? 'Comments' : 'Comment',
            false,
            node.sameline === false,
          ),
        );
      else if (node.type === 'inlinemath') {
        const math = this.math(node, false);
        out.push(math ?? this.opaque(range, 'Equation'));
      } else if (node.type === 'mathenv' && environmentName(node) === 'math') {
        const math = this.equation(node);
        out.push(math ?? this.opaque(range, 'Equation'));
      } else if (node.type === 'macro' && typeof node.content === 'string') {
        const name = node.content;
        if (this.ignoredCommands.has(name)) {
          let end = range.to;
          const next = nodes[i + 1];
          const nextRange = bounds(next, this.source);
          const candidateIndex =
            next?.type === 'whitespace' && nextRange?.from === end ? i + 2 : i + 1;
          const candidate = nodes[candidateIndex];
          const candidateRange = bounds(candidate, this.source);
          const candidateRaw = candidateRange
            ? this.source.slice(candidateRange.from, candidateRange.to)
            : '';
          if (
            (candidate?.type === 'group' && candidateRaw !== '{}') ||
            candidateRaw.startsWith('[')
          ) {
            const last = nodes.length - 1;
            const tail = bounds(nodes[last], this.source);
            if (!tail) return null;
            out.push(this.opaque({ from: range.from, to: tail.to }, name));
            i = last;
            continue;
          }
          if (
            nextRange?.from === end &&
            next?.type === 'group' &&
            this.source.slice(nextRange.from, nextRange.to) === '{}'
          ) {
            end = nextRange.to;
            i++;
          } else if (nextRange?.from === end && next?.type === 'whitespace') {
            // Whitespace after a control word is part of the TeX token delimiter.
            end = nextRange.to;
            i++;
          }
          out.push(this.opaque({ from: range.from, to: end }, 'Ignored source', false, true));
          continue;
        }
        const glyph = proseGlyph(nodes, i, this.source);
        if (glyph) {
          const atom = this.opaque({ from: glyph.from, to: glyph.to }, glyph.text);
          atom.attrs = { ...atom.attrs, visualText: glyph.text };
          if (active.length) atom.marks = active;
          out.push(atom);
          if (glyph.remainder) addText(out, glyph.remainder, active);
          i = glyph.last;
        } else if (name === '\\' || name === 'newline') out.push({ type: 'hardBreak' });
        else if (Object.hasOwn(escapes, name)) {
          addText(out, escapes[name], active);
          const next = nodes[i + 1];
          if (
            (name === 'textbackslash' || name === 'textasciitilde' || name === 'textasciicircum') &&
            next?.type === 'group' &&
            bounds(next, this.source)?.from === range.to &&
            this.source.slice(range.to, bounds(next, this.source)!.to) === '{}'
          )
            i++;
        } else if (Object.hasOwn(marks, name)) {
          const group = nodes[i + 1];
          const groupRange = group && bounds(group, this.source);
          if (
            group?.type === 'group' &&
            groupRange &&
            groupRange.from === range.to &&
            this.source[groupRange.from] === '{' &&
            this.source[groupRange.to - 1] === '}'
          ) {
            const inner = this.inline(children(group), [...active, { type: marks[name] }]);
            if (!inner) return null;
            // Empty groups and embedded source atoms cannot be flattened without changing
            // the scope of their enclosing command. Preserve their complete original slice.
            if (
              !inner.length ||
              protectedNodes({ type: 'doc', content: inner }).length ||
              (name === 'emph' && active.some((mark) => mark.type === 'italic')) ||
              (name === 'texttt' && active.length)
            ) {
              out.push(this.opaque({ from: range.from, to: groupRange.to }, name));
            } else out.push(...inner);
            i++;
          } else {
            out.push(this.opaque(range, name));
          }
        } else {
          const normalized = name.toLowerCase();
          const known =
            referenceCommands.has(normalized) ||
            citationCommands.has(normalized) ||
            otherKnownCommands.has(normalized);
          if (!known) {
            // The unknown macro may consume unbraced arguments or change the
            // interpretation of following text. Keep the complete remaining
            // paragraph together, while leaving preceding prose editable.
            const last = nodes.length - 1;
            const end = bounds(nodes[last], this.source);
            if (!end) return null;
            out.push(this.opaque({ from: range.from, to: end.to }, name));
            i = last;
            continue;
          }
          const expectedGroups =
            twoArgumentReferences.has(normalized) || normalized === 'href' ? 2 : 1;
          const last = this.macroEnd(nodes, i, expectedGroups);
          const groups = nodes.slice(i + 1, last + 1).filter((part) => part.type === 'group');
          if (groups.length !== expectedGroups) return null;
          const end = bounds(nodes[last], this.source);
          if (!end) return null;
          const full = { from: range.from, to: end.to };
          const groupRanges = groups.map((group) => bounds(group, this.source));
          if (
            groupRanges.some(
              (group) =>
                !group || this.source[group.from] !== '{' || this.source[group.to - 1] !== '}',
            )
          )
            return null;
          const keys = groupRanges.map((group) =>
            this.source.slice(group!.from + 1, group!.to - 1),
          );
          const linkLabel =
            normalized === 'href' || normalized === 'url'
              ? linkText(children(groups[normalized === 'href' ? 1 : 0]), this.source)
              : null;
          const label =
            normalized === 'href' || normalized === 'url'
              ? `${name}: ${linkLabel || 'Link'}`
              : keys.every((key) => key && !/[{}]/.test(key))
                ? `${name}: ${keys.join('–')}`
                : name;
          out.push(this.opaque(full, label));
          i = last;
        }
      } else if (node.type === 'group') out.push(this.opaque(range, 'LaTeX group'));
      else out.push(this.opaque(range, 'LaTeX'));
    }
    return out;
  }
  heading(
    nodes: ParsedNode[],
    index: number,
  ): { node: VisualNode; last: number; range: SourceRange } | null {
    const macro = nodes[index];
    if (
      macro.type !== 'macro' ||
      typeof macro.content !== 'string' ||
      !Object.hasOwn(headings, macro.content)
    )
      return null;
    const start = bounds(macro, this.source);
    if (!start) return null;
    let i = index + 1;
    let cursor = start.to;
    let starred = false;
    let optionalTitle = '';
    if (this.source[cursor] === '*' && bounds(nodes[i], this.source)?.from === cursor) {
      starred = true;
      cursor++;
      i++;
    }
    if (this.source[cursor] === '[') {
      const close = this.source.indexOf(']', cursor + 1);
      if (close < 0 || this.source.slice(cursor + 1, close).includes('[')) return null;
      optionalTitle = this.source.slice(cursor, close + 1);
      while (i < nodes.length && (bounds(nodes[i], this.source)?.to ?? -1) <= close + 1) i++;
      cursor = close + 1;
    }
    const group = nodes[i];
    const groupRange = group && bounds(group, this.source);
    if (
      group?.type !== 'group' ||
      !groupRange ||
      groupRange.from !== cursor ||
      this.source[groupRange.to - 1] !== '}'
    )
      return null;
    const content = this.inline(children(group));
    if (!content) return null;
    const range = { from: start.from, to: groupRange.to };
    return {
      node: {
        type: 'heading',
        attrs: {
          sourceId: this.id(range),
          level: headings[macro.content],
          latexCommand: macro.content,
          starred,
          optionalTitle,
        },
        ...(content.length ? { content } : {}),
      },
      last: i,
      range,
    };
  }
  /** Identify a balanced optional argument using the parser's original token ranges. */
  optionalArgument(nodes: ParsedNode[], first: number): { last: number; raw: string } | null {
    const start = bounds(nodes[first], this.source);
    if (!start || this.source.slice(start.from, start.to) !== '[') return null;
    let depth = 0;
    let end = start.from;
    for (let index = first; index < nodes.length; index++) {
      const part = nodes[index];
      const span = bounds(part, this.source);
      if (!span || span.from !== end) return null;
      // Groups and macros are complete TeX units; brackets inside them are not delimiters.
      if (part.type === 'string') {
        for (const char of this.source.slice(span.from, span.to)) {
          if (char === '[') depth++;
          else if (char === ']') depth--;
          if (depth < 0) return null;
        }
      }
      end = span.to;
      if (depth === 0) return { last: index, raw: this.source.slice(start.from, end) };
    }
    return null;
  }
  /** Group neighboring protected blocks while keeping the exact source gap. */
  groupOpaqueBlocks(blocks: VisualBlock[]): VisualBlock[] {
    const grouped: VisualBlock[] = [];
    for (const block of blocks) {
      const previous = grouped.at(-1);
      if (
        previous?.node.type === 'opaqueBlock' &&
        block.node.type === 'opaqueBlock' &&
        Boolean(previous.node.attrs?.hidden) === Boolean(block.node.attrs?.hidden) &&
        (previous.node.attrs?.label === 'Comments') === (block.node.attrs?.label === 'Comments') &&
        previous.to <= block.from &&
        /^\s*$/.test(this.source.slice(previous.to, block.from))
      ) {
        previous.to = block.to;
        previous.node = {
          ...previous.node,
          attrs: {
            ...previous.node.attrs,
            raw: this.source.slice(previous.from, previous.to),
            label: previous.node.attrs?.label === 'Comments' ? 'Comments' : 'LaTeX source',
          },
        };
        this.ranges[previous.id] = { from: previous.from, to: previous.to };
        delete this.ranges[block.id];
      } else grouped.push(block);
    }
    return grouped;
  }
  list(node: ParsedNode): VisualNode | null {
    const range = bounds(node, this.source);
    if (
      !range ||
      !Array.isArray(node.content) ||
      (node.env !== 'itemize' && node.env !== 'enumerate')
    )
      return null;
    const items: VisualNode[] = [];
    let pending: ParsedNode[] = [];
    let itemStart = -1;
    let started = false;
    let latexOptions = '';
    const flush = () => {
      while (pending[0]?.type === 'whitespace') pending.shift();
      while (pending.at(-1)?.type === 'whitespace') pending.pop();
      const originalItemEnd = bounds(pending.at(-1), this.source)?.to ?? itemStart + 5;
      let itemLabel = '';
      let textStart = itemStart + 5;
      if (pending[0] && this.source[bounds(pending[0], this.source)?.from ?? -1] === '[') {
        const label = this.optionalArgument(pending, 0);
        if (!label) return false;
        itemLabel = label.raw;
        textStart = bounds(pending[label.last], this.source)?.to ?? textStart;
        pending.splice(0, label.last + 1);
        while (pending[0]?.type === 'whitespace') pending.shift();
      }
      let parts: VisualNode[] = [];
      let prose: ParsedNode[] = [];
      const flushProse = (emptyPosition?: number) => {
        while (prose[0]?.type === 'whitespace') prose.shift();
        while (prose.at(-1)?.type === 'whitespace') prose.pop();
        const content = this.inline(prose);
        const first = bounds(prose[0], this.source);
        const lastNode = prose.at(-1);
        const last = lastNode ? commentBounds(lastNode, this.source) : null;
        const paragraphRange =
          first && last
            ? { from: first.from, to: last.to }
            : { from: emptyPosition ?? textStart, to: emptyPosition ?? textStart };
        if (!content) {
          if (!first || !last) return false;
          const opaque = this.opaque(paragraphRange, 'LaTeX source', true);
          if (!parts.length)
            parts.push({
              type: 'paragraph',
              attrs: { sourceId: this.id({ from: first.from, to: first.from }) },
            });
          parts.push(opaque);
        } else
          parts.push({
            type: 'paragraph',
            attrs: { sourceId: this.id(paragraphRange) },
            ...(content.length ? { content } : {}),
          });
        prose = [];
        return true;
      };
      for (const child of pending) {
        if (child.type === 'mathenv' && environmentName(child) === 'math') {
          prose.push(child);
          continue;
        }
        if (child.type === 'parbreak') {
          if (prose.some((part) => part.type !== 'whitespace') && !flushProse()) return false;
          prose = [];
        } else if (
          child.type === 'environment' ||
          child.type === 'mathenv' ||
          child.type === 'verbatim' ||
          child.type === 'displaymath'
        ) {
          const childRange = bounds(child, this.source);
          if (!childRange) return false;
          if (
            (prose.some((part) => part.type !== 'whitespace') || !parts.length) &&
            !flushProse(childRange.from)
          )
            return false;
          prose = [];
          const nested = this.blocks([child]);
          if (!nested || nested.length !== 1) return false;
          parts.push(nested[0].node);
        } else prose.push(child);
      }
      if ((prose.some((part) => part.type !== 'whitespace') || !parts.length) && !flushProse())
        return false;
      parts = this.groupOpaqueBlocks(
        parts.map((part) => {
          const id = idOf(part)!;
          const partRange = this.ranges[id];
          return { id, ...partRange, node: part };
        }),
      ).map((block) => block.node);
      const itemEnd = originalItemEnd;
      items.push({
        type: 'listItem',
        attrs: { sourceId: this.id({ from: itemStart, to: itemEnd }), latexItemLabel: itemLabel },
        content: parts,
      });
      pending = [];
      return true;
    };
    for (const child of node.content) {
      if (child.type === 'macro' && child.content === 'item') {
        if (started && !flush()) return null;
        if (!started) {
          let index = 0;
          while (pending[index]?.type === 'whitespace') index++;
          if (
            pending[index] &&
            this.source[bounds(pending[index], this.source)?.from ?? -1] === '['
          ) {
            const option = this.optionalArgument(pending, index);
            if (!option) return null;
            latexOptions = option.raw;
            index = option.last + 1;
          }
          while (pending[index]?.type === 'whitespace') index++;
          if (index !== pending.length) return null;
        }
        pending = [];
        started = true;
        itemStart = bounds(child, this.source)?.from ?? -1;
      } else if (started) pending.push(child);
      else pending.push(child);
    }
    if (!started || !flush()) return null;
    return {
      type: node.env === 'itemize' ? 'bulletList' : 'orderedList',
      attrs: {
        sourceId: this.id(range),
        latexOptions,
        ...(node.env === 'enumerate' ? { start: 1 } : {}),
      },
      content: items,
    };
  }
  ignoredEnvironment(node: ParsedNode): VisualNode | null {
    const env = environmentName(node);
    const range = bounds(node, this.source);
    if (
      node.type !== 'environment' ||
      !Array.isArray(node.content) ||
      !env ||
      !range ||
      !this.ignoredEnvironments.has(env)
    )
      return null;
    const raw = this.source.slice(range.from, range.to);
    const open = `\\begin{${env}}`;
    const close = `\\end{${env}}`;
    if (!raw.startsWith(open) || !raw.endsWith(close)) return null;
    const content = children(node);
    let bodyStart = 0;
    while (content[bodyStart]?.type === 'whitespace') bodyStart++;
    const first = bounds(content[bodyStart], this.source);
    if (first && this.source[first.from] === '[') {
      const option = this.optionalArgument(content, bodyStart);
      if (!option) return null;
      bodyStart = option.last + 1;
    } else bodyStart = 0;
    const body = this.blocks(content.slice(bodyStart));
    if (!body) return null;
    if (!body.length) {
      const closeStart = range.to - close.length;
      const position = this.source[closeStart - 1] === '\n' ? closeStart - 1 : closeStart;
      const id = this.id({ from: position, to: position });
      body.push({
        id,
        from: position,
        to: position,
        node: { type: 'paragraph', attrs: { sourceId: id } },
      });
    }
    return {
      type: 'ignoredEnvironment',
      attrs: { sourceId: this.id(range), environment: env, open, close },
      content: body.map((block) => block.node),
    };
  }
  blocks(nodes: ParsedNode[]): VisualBlock[] | null {
    const result: VisualBlock[] = [];
    let pending: ParsedNode[] = [];
    const flush = () => {
      while (pending[0]?.type === 'whitespace') pending.shift();
      while (pending.at(-1)?.type === 'whitespace') pending.pop();
      if (!pending.length) return true;
      const first = bounds(pending[0], this.source);
      const last = commentBounds(pending.at(-1)!, this.source);
      if (!first || !last) return false;
      const range = { from: first.from, to: last.to };
      const content = this.inline(pending);
      if (!content) {
        const node = this.opaque(range, 'LaTeX source', true);
        result.push({ id: idOf(node)!, ...range, node });
      } else if (
        content.length > 0 &&
        content.every((part) => part.type === 'opaqueInline' && part.attrs?.hidden === true)
      ) {
        for (const part of content) {
          const id = idOf(part);
          if (id) delete this.ranges[id];
        }
        const node = this.opaque(range, 'Ignored source', true, true);
        result.push({ id: idOf(node)!, ...range, node });
      } else {
        const id = this.id(range);
        result.push({
          id,
          ...range,
          node: {
            type: 'paragraph',
            attrs: { sourceId: id },
            ...(content.length ? { content } : {}),
          },
        });
      }
      pending = [];
      return true;
    };
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const range = bounds(node, this.source);
      if (!range) return null;
      if (node.type === 'parbreak') {
        if (!flush()) return null;
        continue;
      }
      if (
        node.type === 'comment' &&
        node.sameline === false &&
        pending.every((part) => part.type === 'whitespace')
      ) {
        if (!flush()) return null;
        const commentRange = commentBounds(node, this.source) ?? range;
        const comment = this.opaque(commentRange, 'Comments', true, true);
        result.push({ id: idOf(comment)!, ...commentRange, node: comment });
        continue;
      }
      const heading = this.heading(nodes, i);
      if (heading) {
        if (!flush()) return null;
        result.push({ id: idOf(heading.node)!, ...heading.range, node: heading.node });
        i = heading.last;
        continue;
      }
      if (node.type === 'mathenv' && environmentName(node) === 'math') {
        pending.push(node);
        continue;
      }
      if (
        node.type === 'environment' ||
        node.type === 'mathenv' ||
        node.type === 'verbatim' ||
        node.type === 'displaymath'
      ) {
        if (!flush()) return null;
        let visual: VisualNode | null = null;
        if (node.type === 'displaymath') visual = this.math(node, true);
        else if (node.type === 'environment' || node.type === 'mathenv') {
          visual = this.equation(node) ?? this.ignoredEnvironment(node) ?? this.list(node);
          if (!visual && (node.env === 'quote' || node.env === 'quotation')) {
            const quoteBlocks = this.blocks(children(node));
            if (quoteBlocks?.length)
              visual = {
                type: 'blockquote',
                attrs: { sourceId: this.id(range), latexEnvironment: node.env },
                content: quoteBlocks.map((block) => block.node),
              };
          }
        }
        const envLabel =
          typeof node.env === 'string'
            ? node.env
            : (node.env as unknown as { content?: string } | undefined)?.content;
        visual ??= this.opaque(
          range,
          envLabel || (node.type === 'displaymath' ? 'Equation' : 'LaTeX'),
          true,
        );
        result.push({ id: idOf(visual)!, ...range, node: visual });
        continue;
      }
      pending.push(node);
    }
    return flush() ? this.groupOpaqueBlocks(result) : null;
  }
}

/** Import without modifying or serializing the source. Unknown constructs stay opaque. */
export function importLatex(source: string, options?: VisualImportOptions): Projection {
  const importer = new Importer(source, options);
  let blocks: VisualBlock[] | null = null;
  try {
    const ast = parseMinimal(source) as unknown as ParsedNode;
    const root = children(ast);
    const document = root.find((node) => node.type === 'environment' && node.env === 'document');
    if (document) {
      const range = bounds(document, source);
      if (range) {
        const open = source.indexOf('\\begin{document}', range.from);
        const close = source.lastIndexOf('\\end{document}', range.to);
        if (open === range.from && close >= open) {
          const setupRange = { from: 0, to: open + '\\begin{document}'.length };
          const setup = importer.opaque(setupRange, 'Document setup', true);
          const body = importer.blocks(children(document));
          if (body) {
            if (!body.length) {
              const beforeEnd = source[close - 1] === '\n' ? close - 1 : close;
              const id = importer.id({ from: beforeEnd, to: beforeEnd });
              body.push({
                id,
                from: beforeEnd,
                to: beforeEnd,
                node: { type: 'paragraph', attrs: { sourceId: id } },
              });
            }
            blocks = [{ id: idOf(setup)!, ...setupRange, node: setup }, ...body];
          }
        }
      }
    } else blocks = importer.blocks(root);
  } catch {
    /* The whole source remains accessible through one opaque block. */
  }
  if (!blocks) {
    const range = { from: 0, to: source.length };
    const node = importer.opaque(range, 'LaTeX source', true);
    blocks = [{ id: idOf(node)!, ...range, node }];
  }
  if (!blocks.length) {
    const id = importer.id();
    blocks.push({
      id,
      from: source.length,
      to: source.length,
      node: { type: 'paragraph', attrs: { sourceId: id } },
    });
  }
  const doc: VisualNode = { type: 'doc', content: blocks.map((block) => block.node) };
  return { source, doc, blocks, ranges: importer.ranges };
}

/** Compare semantic content, ignoring schema defaults that Tiptap adds during import. */
function signature(node: VisualNode): string {
  const attrs = node.attrs ?? {};
  const keys = [
    'sourceId',
    'level',
    'latexCommand',
    'starred',
    'optionalTitle',
    'latexEnvironment',
    'environment',
    'hidden',
    'latexOptions',
    'latexItemLabel',
    'start',
    'raw',
    'label',
    'latex',
    'open',
    'close',
    'visualText',
  ];
  const meaningful = Object.fromEntries(
    keys
      .filter(
        (key) =>
          attrs[key] !== undefined &&
          attrs[key] !== null &&
          attrs[key] !== false &&
          attrs[key] !== '',
      )
      .map((key) => [key, attrs[key]]),
  );
  // Tiptap sets ordered list start to 1 even when the imported JSON omitted it.
  if (node.type === 'orderedList' && meaningful.start === undefined) meaningful.start = 1;
  return JSON.stringify({
    type: node.type,
    attrs: meaningful,
    text: node.text ?? '',
    marks: (node.marks ?? []).map((mark) => mark.type),
    content: (node.content ?? []).map(signature),
  });
}

function protectedNodes(node: VisualNode, output: VisualNode[] = []): VisualNode[] {
  if (
    ['opaqueInline', 'opaqueBlock', 'inlineMath', 'blockMath', 'ignoredEnvironment'].includes(
      node.type,
    ) &&
    !isProseGlyph(node)
  )
    output.push(node);
  for (const child of node.content ?? []) protectedNodes(child, output);
  return output;
}
function allNodes(node: VisualNode, output: VisualNode[] = []): VisualNode[] {
  output.push(node);
  for (const child of node.content ?? []) allNodes(child, output);
  return output;
}

interface Serialized {
  text: string;
  ranges: Record<string, SourceRange>;
}
class Writer {
  text = '';
  ranges: Record<string, SourceRange> = Object.create(null) as Record<string, SourceRange>;
  private readonly oldNodes = new Map<string, VisualNode>();
  constructor(private readonly projection: Projection) {
    for (const node of allNodes(projection.doc)) {
      const id = idOf(node);
      if (id) this.oldNodes.set(id, node);
    }
  }
  append(value: string): void {
    this.text += value;
  }
  region(node: VisualNode, write: () => void): void {
    const from = this.text.length;
    const id = idOf(node);
    const previous = id ? this.oldNodes.get(id) : undefined;
    const previousRange = id ? this.projection.ranges[id] : undefined;
    if (previous && previousRange && signature(previous) === signature(node)) {
      this.append(this.projection.source.slice(previousRange.from, previousRange.to));
      for (const child of allNodes(previous)) {
        const childId = idOf(child);
        const childRange = childId ? this.projection.ranges[childId] : undefined;
        if (
          childId &&
          childRange &&
          childRange.from >= previousRange.from &&
          childRange.to <= previousRange.to
        ) {
          this.ranges[childId] = {
            from: from + childRange.from - previousRange.from,
            to: from + childRange.to - previousRange.from,
          };
        }
      }
      return;
    }
    write();
    if (id) this.ranges[id] = { from, to: this.text.length };
  }
  /** Preserve an existing container's delimiters and the original gaps between surviving children. */
  container(
    node: VisualNode,
    prefix: string,
    separator: string,
    suffix: string,
    writeChild: (child: VisualNode) => void,
  ): void {
    const id = idOf(node);
    const old = id ? this.oldNodes.get(id) : undefined;
    const parentRange = id ? this.projection.ranges[id] : undefined;
    const oldChildren = old?.content ?? [];
    const oldRanges = oldChildren.map((child) => {
      const childId = idOf(child);
      return childId ? this.projection.ranges[childId] : undefined;
    });
    const usable =
      old &&
      old.type === node.type &&
      (old.attrs?.latexOptions ?? '') === (node.attrs?.latexOptions ?? '') &&
      (old.attrs?.latexItemLabel ?? '') === (node.attrs?.latexItemLabel ?? '') &&
      (old.attrs?.latexEnvironment ?? '') === (node.attrs?.latexEnvironment ?? '') &&
      parentRange &&
      oldChildren.length > 0 &&
      oldRanges.every(
        (range, index) =>
          range &&
          range.from >= parentRange.from &&
          range.to <= parentRange.to &&
          (!index || oldRanges[index - 1]!.to <= range.from),
      );
    const source = this.projection.source;
    if (usable) {
      const preservedPrefix = source.slice(parentRange.from, oldRanges[0]!.from);
      this.append(preservedPrefix);
      // An empty item has a zero-width paragraph immediately after \item. If it
      // acquires text, a separator is required so it cannot become \itemText.
      if (
        node.type === 'listItem' &&
        /\\item$/.test(preservedPrefix) &&
        (node.content?.[0]?.content?.length ?? 0) > 0
      )
        this.append(' ');
    } else this.append(prefix);
    const nextChildren = node.content ?? [];
    nextChildren.forEach((child, index) => {
      if (index) {
        const previousId = idOf(nextChildren[index - 1]);
        const currentId = idOf(child);
        const oldIndex = oldChildren.findIndex((previous) => idOf(previous) === previousId);
        if (
          usable &&
          oldIndex >= 0 &&
          idOf(oldChildren[oldIndex + 1] ?? { type: '' }) === currentId
        )
          this.append(source.slice(oldRanges[oldIndex]!.to, oldRanges[oldIndex + 1]!.from));
        else this.append(separator);
      }
      writeChild(child);
    });
    if (usable) this.append(source.slice(oldRanges[oldRanges.length - 1]!.to, parentRange.to));
    else this.append(suffix);
  }
  inline(node: VisualNode): void {
    if (node.type === 'text') {
      const wrappers = (node.marks ?? []).map((mark) => markCommands[mark.type]);
      if (wrappers.some((value) => !value)) throw new Error('This formatting needs Code mode.');
      for (const wrapper of wrappers) this.append(`\\${wrapper}{`);
      this.append(escapeText(node.text ?? ''));
      this.append('}'.repeat(wrappers.length));
    } else if (node.type === 'hardBreak') this.append('\\\\\n');
    else if (node.type === 'opaqueInline') {
      const wrappers = isProseGlyph(node)
        ? (node.marks ?? []).map((mark) => markCommands[mark.type])
        : [];
      if (wrappers.some((value) => !value)) throw new Error('This formatting needs Code mode.');
      for (const wrapper of wrappers) this.append(`\\${wrapper}{`);
      this.region(node, () => this.append(String(node.attrs?.raw ?? '')));
      this.append('}'.repeat(wrappers.length));
    } else if (node.type === 'inlineMath')
      this.region(node, () =>
        this.append(
          `${String(node.attrs?.open ?? '$')}${String(node.attrs?.latex ?? '')}${String(node.attrs?.close ?? '$')}`,
        ),
      );
    else throw new Error('This inline content needs Code mode.');
  }
  block(node: VisualNode): void {
    this.region(node, () => {
      switch (node.type) {
        case 'paragraph':
          for (const child of node.content ?? []) this.inline(child);
          break;
        case 'heading': {
          const attrs = node.attrs ?? {};
          const level = Number(attrs.level ?? 2);
          const command =
            typeof attrs.latexCommand === 'string' && Object.hasOwn(headings, attrs.latexCommand)
              ? attrs.latexCommand
              : (
                  {
                    1: 'section',
                    2: 'subsection',
                    3: 'subsubsection',
                    4: 'paragraph',
                    5: 'subparagraph',
                    6: 'subparagraph',
                  } as Record<number, string>
                )[level];
          if (!command) throw new Error('This heading needs Code mode.');
          this.append(
            `\\${command}${attrs.starred ? '*' : ''}${typeof attrs.optionalTitle === 'string' ? attrs.optionalTitle : ''}{`,
          );
          for (const child of node.content ?? []) this.inline(child);
          this.append('}');
          break;
        }
        case 'bulletList':
        case 'orderedList': {
          const env = node.type === 'bulletList' ? 'itemize' : 'enumerate';
          const options =
            typeof node.attrs?.latexOptions === 'string' ? node.attrs.latexOptions : '';
          this.container(node, `\\begin{${env}}${options}\n`, '\n', `\n\\end{${env}}`, (item) => {
            if (item.type !== 'listItem') throw new Error('This list needs Code mode.');
            this.region(item, () => {
              const label =
                typeof item.attrs?.latexItemLabel === 'string' ? item.attrs.latexItemLabel : '';
              this.container(item, `\\item${label} `, '\n', '', (part) => this.block(part));
            });
          });
          break;
        }
        case 'blockquote': {
          const env = node.attrs?.latexEnvironment === 'quotation' ? 'quotation' : 'quote';
          this.container(node, `\\begin{${env}}\n`, '\n\n', `\n\\end{${env}}`, (child) =>
            this.block(child),
          );
          break;
        }
        case 'ignoredEnvironment': {
          const open = node.attrs?.open;
          const close = node.attrs?.close;
          if (typeof open !== 'string' || typeof close !== 'string')
            throw new Error('This environment needs Code mode.');
          this.container(node, `${open}\n`, '\n\n', `\n${close}`, (child) => this.block(child));
          break;
        }
        case 'opaqueBlock':
          this.append(String(node.attrs?.raw ?? ''));
          break;
        case 'blockMath':
          this.append(
            `${String(node.attrs?.open ?? '$$')}${String(node.attrs?.latex ?? '')}${String(node.attrs?.close ?? '$$')}`,
          );
          break;
        default:
          throw new Error('This content needs Code mode.');
      }
    });
  }
}
function serialize(node: VisualNode, projection: Projection): Serialized {
  const writer = new Writer(projection);
  writer.block(node);
  return { text: writer.text, ranges: writer.ranges };
}

/** Produce a single bounded source replacement and advance provenance without reparsing. */
export function projectChanges(projection: Projection, updatedDoc: VisualNode): ProjectionChange {
  const next = updatedDoc.content ?? [];
  if (updatedDoc.type !== 'doc' || !next.length)
    return { ok: false, error: 'The document cannot be empty in Visual mode.' };
  const previousProtected = protectedNodes(projection.doc);
  const nextProtected = protectedNodes(updatedDoc);
  const setupId = idOf(projection.blocks[0]?.node ?? { type: '' });
  if (
    projection.blocks[0]?.node.type === 'opaqueBlock' &&
    projection.blocks[0]?.node.attrs?.label === 'Document setup' &&
    idOf(next[0]) !== setupId
  )
    return {
      ok: false,
      error: 'Text must remain inside the document. Use Code mode to edit document setup.',
    };
  if (
    previousProtected.length !== nextProtected.length ||
    previousProtected.some((node, index) => {
      const other = nextProtected[index];
      return (
        !other ||
        node.type !== other.type ||
        idOf(node) !== idOf(other) ||
        node.attrs?.raw !== other.attrs?.raw ||
        node.attrs?.environment !== other.attrs?.environment ||
        Boolean(node.attrs?.hidden) !== Boolean(other.attrs?.hidden) ||
        node.attrs?.open !== other.attrs?.open ||
        node.attrs?.close !== other.attrs?.close
      );
    })
  )
    return { ok: false, error: 'Edit the protected source block in Code mode or use Edit source.' };
  const ids = next.map(idOf);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
    return { ok: false, error: 'The visual document could not be mapped to its source.' };
  const old = projection.blocks;
  let prefix = 0;
  while (
    prefix < old.length &&
    prefix < next.length &&
    old[prefix].id === ids[prefix] &&
    signature(old[prefix].node) === signature(next[prefix])
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < old.length - prefix &&
    suffix < next.length - prefix &&
    old[old.length - 1 - suffix].id === ids[next.length - 1 - suffix] &&
    signature(old[old.length - 1 - suffix].node) === signature(next[next.length - 1 - suffix])
  )
    suffix++;
  if (prefix === old.length && prefix === next.length)
    return { ok: true, edits: [], nextProjection: { ...projection, doc: updatedDoc } };
  const oldEnd = old.length - suffix;
  const nextEnd = next.length - suffix;
  const from = prefix < old.length ? old[prefix].from : (old.at(-1)?.to ?? 0);
  const to = oldEnd > prefix ? old[oldEnd - 1].to : from;
  const oldById = new Map(old.map((block) => [block.id, block]));
  const generated: {
    node: VisualNode;
    id: string;
    raw: string;
    ranges: Record<string, SourceRange>;
    from: number;
    to: number;
  }[] = [];
  let replacement = '';
  try {
    for (let i = prefix; i < nextEnd; i++) {
      const node = next[i];
      const id = ids[i]!;
      const previous = oldById.get(id);
      const unchanged = previous && signature(previous.node) === signature(node);
      let rendered: Serialized;
      if (unchanged && previous) {
        const ranges: Record<string, SourceRange> = Object.create(null) as Record<
          string,
          SourceRange
        >;
        for (const child of allNodes(previous.node)) {
          const childId = idOf(child);
          const original = childId && projection.ranges[childId];
          if (childId && original)
            ranges[childId] = {
              from: original.from - previous.from,
              to: original.to - previous.from,
            };
        }
        rendered = { text: projection.source.slice(previous.from, previous.to), ranges };
      } else rendered = serialize(node, projection);
      if (i > prefix) {
        const priorOld = oldById.get(ids[i - 1]!);
        const priorIndex = priorOld && old.indexOf(priorOld);
        replacement +=
          priorOld && previous && priorIndex !== undefined && old[priorIndex + 1] === previous
            ? projection.source.slice(priorOld.to, previous.from)
            : '\n\n';
      }
      const offset = replacement.length;
      replacement += rendered.text;
      generated.push({
        node,
        id,
        raw: rendered.text,
        ranges: rendered.ranges,
        from: offset,
        to: replacement.length,
      });
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'This edit needs Code mode.',
    };
  }
  if (oldEnd === prefix && nextEnd > prefix) {
    if (prefix < old.length) replacement += '\n\n';
    else if (old.length) {
      replacement = `\n\n${replacement}`;
      for (const block of generated) {
        block.from += 2;
        block.to += 2;
      }
    }
  }
  const result = projection.source.slice(0, from) + replacement + projection.source.slice(to);
  const delta = replacement.length - (to - from);
  const nextBlocks: VisualBlock[] = [
    ...old.slice(0, prefix).map((block, index) => ({ ...block, node: next[index] })),
    ...generated.map((block) => ({
      id: block.id,
      from: from + block.from,
      to: from + block.to,
      node: block.node,
    })),
    ...old.slice(oldEnd).map((block, index) => ({
      ...block,
      from: block.from + delta,
      to: block.to + delta,
      node: next[nextEnd + index],
    })),
  ];
  const ranges: Record<string, SourceRange> = Object.create(null) as Record<string, SourceRange>;
  for (const [id, range] of Object.entries(projection.ranges)) {
    if (range.to <= from) ranges[id] = range;
    else if (range.from >= to) ranges[id] = { from: range.from + delta, to: range.to + delta };
  }
  for (const block of generated)
    for (const [id, range] of Object.entries(block.ranges))
      ranges[id] = { from: from + block.from + range.from, to: from + block.from + range.to };
  for (const block of nextBlocks) ranges[block.id] = { from: block.from, to: block.to };
  let left = 0;
  while (
    left < to - from &&
    left < replacement.length &&
    projection.source[from + left] === replacement[left]
  )
    left++;
  let right = 0;
  while (
    right < to - from - left &&
    right < replacement.length - left &&
    projection.source[to - 1 - right] === replacement[replacement.length - 1 - right]
  )
    right++;
  const edit = {
    from: from + left,
    to: to - right,
    insert: replacement.slice(left, replacement.length - right),
  };
  const oldMiddle = projection.source.slice(edit.from, edit.to);
  const changes = diffChars(oldMiddle, edit.insert, { timeout: 20, maxEditLength: 10000 });
  const edits: SourceEdit[] = [];
  if (changes) {
    let cursor = edit.from;
    let pending: SourceEdit | undefined;
    const flush = () => {
      if (pending) {
        edits.push(pending);
        pending = undefined;
      }
    };
    for (const part of changes) {
      if (part.added) {
        pending ??= { from: cursor, to: cursor, insert: '' };
        pending.insert += part.value;
      } else if (part.removed) {
        pending ??= { from: cursor, to: cursor, insert: '' };
        cursor += part.value.length;
        pending.to = cursor;
      } else {
        flush();
        cursor += part.value.length;
      }
    }
    flush();
  } else if (edit.from !== edit.to || edit.insert) edits.push(edit);
  return {
    ok: true,
    edits,
    nextProjection: { source: result, doc: updatedDoc, blocks: nextBlocks, ranges },
  };
}

/** Map a visible text offset to the closest safe source position within its block. */
export function sourceOffsetForPosition(
  projection: Projection,
  blockId: string,
  textOffset: number,
): number {
  const range =
    projection.ranges[blockId] ?? projection.blocks.find((block) => block.id === blockId);
  if (!range) return 0;
  const raw = projection.source.slice(range.from, range.to);
  const hiddenRanges = allNodes(projection.doc)
    .filter((node) => node.type === 'opaqueInline' && node.attrs?.hidden === true)
    .map((node) => {
      const id = idOf(node);
      return id ? projection.ranges[id] : undefined;
    })
    .filter((hidden): hidden is SourceRange =>
      Boolean(hidden && hidden.from >= range.from && hidden.to <= range.to),
    );
  const hiddenStartsAt = (offset: number) =>
    hiddenRanges.some((hidden) => hidden.from === range.from + offset);
  // Local-only parse; malformed content returns the start instead of an unsafe guess.
  try {
    const ast = parseMinimal(raw) as unknown as ParsedNode;
    let remaining = Math.max(0, textOffset);
    let last = 0;
    const walk = (nodes: ParsedNode[]): number | null => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const span = bounds(node, raw);
        if (!span) continue;
        const hidden = hiddenRanges.find(
          (item) => item.from <= range.from + span.from && item.to > range.from + span.from,
        );
        if (hidden) {
          last = hidden.to - range.from;
          while (i + 1 < nodes.length && (bounds(nodes[i + 1], raw)?.to ?? Infinity) <= last) i++;
          continue;
        }
        const glyph = proseGlyph(nodes, i, raw);
        if (glyph) {
          if (
            remaining < glyph.text.length ||
            (remaining === glyph.text.length && !hiddenStartsAt(glyph.to))
          )
            return remaining ? glyph.to : glyph.from;
          remaining -= glyph.text.length;
          last = glyph.to;
          if (
            glyph.remainder &&
            glyph.remainderFrom !== undefined &&
            glyph.remainderTo !== undefined
          ) {
            if (remaining <= glyph.remainder.length) return glyph.remainderFrom + remaining;
            remaining -= glyph.remainder.length;
            last = glyph.remainderTo;
          }
          i = glyph.last;
          continue;
        }
        if (node.type === 'string' || node.type === 'whitespace') {
          const length = node.type === 'whitespace' ? 1 : span.to - span.from;
          if (remaining < length || (remaining === length && !hiddenStartsAt(span.to)))
            return (
              span.from +
              (node.type === 'whitespace' ? Math.min(remaining, span.to - span.from) : remaining)
            );
          remaining -= length;
          last = span.to;
        } else if (node.type === 'group') {
          const found = walk(children(node));
          if (found !== null) return found;
        } else if (node.type === 'environment') {
          const found = walk(children(node));
          if (found !== null) return found;
        } else if (
          node.type === 'macro' &&
          typeof node.content === 'string' &&
          Object.hasOwn(escapes, node.content)
        ) {
          const next = nodes[i + 1];
          const nextSpan = bounds(next, raw);
          const isEmptyDelimiter =
            ['textbackslash', 'textasciitilde', 'textasciicircum'].includes(node.content) &&
            next?.type === 'group' &&
            nextSpan?.from === span.to &&
            raw.slice(nextSpan.from, nextSpan.to) === '{}';
          const end = isEmptyDelimiter ? nextSpan.to : span.to;
          if (remaining < 1 || (remaining === 1 && !hiddenStartsAt(end)))
            return remaining ? end : span.from;
          remaining--;
          last = end;
          if (isEmptyDelimiter) i++;
        } else if (
          node.type === 'macro' &&
          typeof node.content === 'string' &&
          Object.hasOwn(marks, node.content)
        ) {
          // The following group is visited on the next iteration.
        } else if (
          node.type === 'macro' &&
          typeof node.content === 'string' &&
          Object.hasOwn(headings, node.content)
        ) {
          // Skip the heading syntax; its argument group contains the visible title.
        } else last = span.to;
      }
      return null;
    };
    const parsed = children(ast);
    const headingNode = parsed[0];
    const visibleNodes =
      headingNode?.type === 'macro' &&
      typeof headingNode.content === 'string' &&
      Object.hasOwn(headings, headingNode.content)
        ? children([...parsed].reverse().find((node) => node.type === 'group') ?? ast)
        : parsed;
    return range.from + (walk(visibleNodes) ?? last);
  } catch {
    return range.from;
  }
}
