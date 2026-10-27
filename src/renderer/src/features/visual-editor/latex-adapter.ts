import { parseMinimal } from '@unified-latex/unified-latex-util-parse';
import { diffChars } from 'diff';

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
};
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
function idOf(node: VisualNode): string | undefined {
  return typeof node.attrs?.sourceId === 'string' ? node.attrs.sourceId : undefined;
}
function children(node: ParsedNode): ParsedNode[] {
  return Array.isArray(node.content) ? node.content : [];
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
  readonly ranges: Record<string, SourceRange> = Object.create(null) as Record<string, SourceRange>;
  constructor(readonly source: string) {}
  id(range?: SourceRange): string {
    const id = `s${this.next++}`;
    if (range) this.ranges[id] = range;
    return id;
  }
  opaque(range: SourceRange, label: string, block = false): VisualNode {
    return {
      type: block ? 'opaqueBlock' : 'opaqueInline',
      attrs: { sourceId: this.id(range), raw: this.source.slice(range.from, range.to), label },
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
    return {
      type: block ? 'blockMath' : 'inlineMath',
      attrs: {
        sourceId: this.id(range),
        raw,
        open,
        close,
        latex: raw.slice(open.length, -close.length),
      },
    };
  }
  equation(node: ParsedNode): VisualNode | null {
    const env =
      typeof node.env === 'string'
        ? node.env
        : (node.env as unknown as { content?: string } | undefined)?.content;
    if (
      (node.type !== 'environment' && node.type !== 'mathenv') ||
      (env !== 'equation' && env !== 'equation*')
    )
      return null;
    const range = bounds(node, this.source);
    if (!range) return null;
    const raw = this.source.slice(range.from, range.to);
    const open = `\\begin{${env}}`;
    const close = `\\end{${env}}`;
    if (!raw.startsWith(open) || !raw.endsWith(close)) return null;
    const latex = raw.slice(open.length, -close.length);
    if (/^\s*\[/.test(latex) || /\\(?:label|tag|notag|nonumber|begin|end)\b/.test(latex))
      return null;
    return { type: 'blockMath', attrs: { sourceId: this.id(range), raw, open, close, latex } };
  }
  /** Gather only balanced, immediately attached arguments. Never guess macro expansion. */
  macroEnd(nodes: ParsedNode[], index: number): number {
    const initial = bounds(nodes[index], this.source);
    if (!initial) return index;
    let i = index;
    let end = initial.to;
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
        const ligature = raw.length === 1 && "-`'".includes(raw) && this.source[range.to] === raw;
        if (ligature) {
          let last = i + 1;
          while (
            last + 1 < nodes.length &&
            bounds(nodes[last + 1], this.source)?.from === bounds(nodes[last], this.source)?.to &&
            this.source.slice(
              bounds(nodes[last + 1], this.source)!.from,
              bounds(nodes[last + 1], this.source)!.to,
            ) === raw
          )
            last++;
          out.push(
            this.opaque(
              { from: range.from, to: bounds(nodes[last], this.source)!.to },
              'LaTeX punctuation',
            ),
          );
          i = last;
        } else if (/[{}$~&_^#]/.test(raw) || /--|``|''/.test(raw))
          out.push(this.opaque(range, 'LaTeX'));
        else addText(out, raw, active);
      } else if (node.type === 'whitespace') addText(out, ' ', active);
      else if (node.type === 'comment') out.push(this.opaque(range, 'Comment'));
      else if (node.type === 'inlinemath') {
        const math = this.math(node, false);
        out.push(math ?? this.opaque(range, 'Equation'));
      } else if (node.type === 'macro' && typeof node.content === 'string') {
        const name = node.content;
        if (name === '\\' || name === 'newline') out.push({ type: 'hardBreak' });
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
          const known =
            /^(?:cite|citep|citet|citeauthor|citeyear|parencite|textcite|ref|eqref|pageref|autoref|label|footnote|input|include|subfile)$/i.test(
              name,
            );
          if (!known) return null;
          const last = this.macroEnd(nodes, i);
          if (!nodes.slice(i + 1, last + 1).some((part) => part.type === 'group')) return null;
          const end = bounds(nodes[last], this.source);
          if (!end) return null;
          const full = { from: range.from, to: end.to };
          const value = this.source.slice(full.from, full.to);
          const key = /\{([^{}]*)\}$/.exec(value)?.[1];
          const label = known && key ? `${name}: ${key}` : name;
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
    const flush = () => {
      while (pending[0]?.type === 'whitespace') pending.shift();
      while (pending.at(-1)?.type === 'whitespace') pending.pop();
      if (pending[0] && this.source[bounds(pending[0], this.source)?.from ?? -1] === '[')
        return false;
      const parts: VisualNode[] = [];
      let prose: ParsedNode[] = [];
      const flushProse = () => {
        while (prose[0]?.type === 'whitespace') prose.shift();
        while (prose.at(-1)?.type === 'whitespace') prose.pop();
        const content = this.inline(prose);
        if (!content) return false;
        const first = bounds(prose[0], this.source);
        const last = bounds(prose.at(-1), this.source);
        const paragraphRange = first && last ? { from: first.from, to: last.to } : undefined;
        parts.push({
          type: 'paragraph',
          attrs: { sourceId: this.id(paragraphRange) },
          ...(content.length ? { content } : {}),
        });
        prose = [];
        return true;
      };
      for (const child of pending) {
        if (
          child.type === 'environment' &&
          (child.env === 'itemize' || child.env === 'enumerate')
        ) {
          if ((prose.length || !parts.length) && !flushProse()) return false;
          const nested = this.list(child);
          if (!nested) return false;
          parts.push(nested);
        } else prose.push(child);
      }
      if ((prose.length || !parts.length) && !flushProse()) return false;
      const itemEnd = bounds(pending.at(-1), this.source)?.to ?? itemStart;
      items.push({
        type: 'listItem',
        attrs: { sourceId: this.id({ from: itemStart, to: itemEnd }) },
        content: parts,
      });
      pending = [];
      return true;
    };
    for (const child of node.content) {
      if (child.type === 'macro' && child.content === 'item') {
        if (started && !flush()) return null;
        if (!started && pending.some((part) => part.type !== 'whitespace')) return null;
        pending = [];
        started = true;
        itemStart = bounds(child, this.source)?.from ?? -1;
      } else if (started) pending.push(child);
      else pending.push(child);
    }
    if (!started || !flush()) return null;
    return {
      type: node.env === 'itemize' ? 'bulletList' : 'orderedList',
      attrs: { sourceId: this.id(range), ...(node.env === 'enumerate' ? { start: 1 } : {}) },
      content: items,
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
      const last = bounds(pending.at(-1)!, this.source);
      if (!first || !last) return false;
      const range = { from: first.from, to: last.to };
      const content = this.inline(pending);
      if (!content) {
        const node = this.opaque(range, 'LaTeX source', true);
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
      const heading = this.heading(nodes, i);
      if (heading) {
        if (!flush()) return null;
        result.push({ id: idOf(heading.node)!, ...heading.range, node: heading.node });
        i = heading.last;
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
          visual = this.equation(node) ?? this.list(node);
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
    return flush() ? result : null;
  }
}

/** Import without modifying or serializing the source. Unknown constructs stay opaque. */
export function importLatex(source: string): Projection {
  const importer = new Importer(source);
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
    'start',
    'raw',
    'label',
    'latex',
    'open',
    'close',
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
  if (['opaqueInline', 'opaqueBlock', 'inlineMath', 'blockMath'].includes(node.type))
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
    if (usable) this.append(source.slice(parentRange.from, oldRanges[0]!.from));
    else this.append(prefix);
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
      const wrappers = (node.marks ?? []).map(
        (mark) => ({ bold: 'textbf', italic: 'textit', code: 'texttt' })[mark.type],
      );
      if (wrappers.some((value) => !value)) throw new Error('This formatting needs Code mode.');
      for (const wrapper of wrappers) this.append(`\\${wrapper}{`);
      this.append(escapeText(node.text ?? ''));
      this.append('}'.repeat(wrappers.length));
    } else if (node.type === 'hardBreak') this.append('\\\\\n');
    else if (node.type === 'opaqueInline')
      this.region(node, () => this.append(String(node.attrs?.raw ?? '')));
    else if (node.type === 'inlineMath')
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
          this.container(node, `\\begin{${env}}\n`, '\n', `\n\\end{${env}}`, (item) => {
            if (item.type !== 'listItem') throw new Error('This list needs Code mode.');
            this.region(item, () => {
              this.container(item, '\\item ', '\n', '', (part) => this.block(part));
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
        if (node.type === 'string' || node.type === 'whitespace') {
          const length = node.type === 'whitespace' ? 1 : span.to - span.from;
          if (remaining <= length)
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
          if (remaining <= 1) return remaining ? end : span.from;
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
