import { getParser, parseMinimal } from '@unified-latex/unified-latex-util-parse';
import { parseAlignEnvironment } from '@unified-latex/unified-latex-util-align';
import { toString } from '@unified-latex/unified-latex-util-to-string';
import type * as Ast from '@unified-latex/unified-latex-types';
import type { Result } from '../../../../shared/api';
import katex from 'katex';
import {
  cleanTitle,
  parseTexStructure,
  referenceCandidates,
} from '../../../../shared/tex-structure';
import { importLatex, type VisualNode } from './latex-adapter';
import './visual-block-preview.css';

const captionParser = getParser({
  macros: {
    caption: { signature: 'o m' },
    title: { signature: 'm' },
    author: { signature: 'm' },
    date: { signature: 'm' },
  },
});

// Node views may be rebuilt together. Share only concurrent reads so later file
// changes are never hidden by a persistent positive or negative cache.
const pendingPdfCandidates = new Map<string, Promise<Result<Uint8Array>>>();
function readPdfCandidate(projectId: string, path: string): Promise<Result<Uint8Array>> {
  const key = JSON.stringify([projectId, path]);
  const pending = pendingPdfCandidates.get(key);
  if (pending) return pending;
  const request = window.textra.readProjectPdfCandidate({ projectId, path });
  pendingPdfCandidates.set(key, request);
  void request.then(
    () => {
      if (pendingPdfCandidates.get(key) === request) pendingPdfCandidates.delete(key);
    },
    () => {
      if (pendingPdfCandidates.get(key) === request) pendingPdfCandidates.delete(key);
    },
  );
  return request;
}

/** Probe candidate paths in order, but never turn a real read error into a miss. */
export async function resolvePdfFigure(
  projectId: string,
  paths: readonly string[],
  cancelled: () => boolean = () => false,
): Promise<Result<Uint8Array> | null> {
  for (const path of paths) {
    if (cancelled()) return null;
    const result = await readPdfCandidate(projectId, path);
    if (cancelled()) return null;
    if (result.ok || result.code !== 'NOT_FOUND') return result;
  }
  return null;
}

/** A plain-text summary; source remains authoritative and editable in the enclosing node. */
export interface FigurePreview {
  target: string;
  caption: string;
}

/** Resolve only PDF candidates: explicit image types never imply an appended .pdf. */
export function pdfFigureCandidates(target: string, sourcePath: string): string[] {
  const filename = target.split('/').at(-1) ?? '';
  const extension = /\.[^.]+$/.exec(filename)?.[0].toLowerCase();
  if (extension && extension !== '.pdf') return [];
  return referenceCandidates(
    {
      kind: 'text',
      command: 'includegraphics',
      target: extension ? target : `${target}.pdf`,
      line: 1,
    },
    sourcePath,
  );
}

export function inspectFigure(source: string): FigurePreview | null {
  if (!/^\\begin\{figure\*?\}/.test(source.trimStart())) return null;
  const references = parseTexStructure(source).references.filter(
    (reference) => reference.kind === 'graphic',
  );
  if (references.length !== 1) return null;
  let caption = '';
  try {
    const root = captionParser.parse(source);
    const walk = (nodes: Ast.Node[]) => {
      for (const node of nodes) {
        if (node.type === 'macro' && node.content === 'caption') {
          const value = node.args?.find((arg) => arg.openMark === '{');
          if (value) caption = cleanTitle(toString(value.content));
        }
        if ('content' in node && Array.isArray(node.content)) walk(node.content as Ast.Node[]);
      }
    };
    walk(root.content);
  } catch {
    // A missing caption does not invalidate a safely parsed graphic reference.
  }
  return { target: references[0].target, caption };
}

export function inspectMetadata(
  source: string,
): { title?: string; author?: string; date?: string } | null {
  if (!source.includes('\\begin{document}')) return null;
  const fields: { title?: string; author?: string; date?: string } = {};
  try {
    const root = captionParser.parse(source);
    for (const node of root.content) {
      if (node.type !== 'macro' || !['title', 'author', 'date'].includes(node.content)) continue;
      const argument = node.args?.find((arg) => arg.openMark === '{');
      if (argument)
        fields[node.content as 'title' | 'author' | 'date'] = cleanTitle(
          toString(argument.content),
        );
    }
  } catch {
    return null;
  }
  return Object.values(fields).some(Boolean) ? fields : null;
}

/** Parse the grid with unified-latex, refusing structures we cannot render faithfully. */
export function parseTablePreview(source: string): VisualNode[][][] | null {
  if (source.length > 100_000) return null;
  try {
    const root = parseMinimal(source);
    const tables: Ast.Environment[] = [];
    const find = (nodes: Ast.Node[]) => {
      for (const node of nodes) {
        if (node.type === 'environment' && node.env === 'tabular') tables.push(node);
        else if (node.type === 'environment') find(node.content);
      }
    };
    find(root.content);
    if (tables.length !== 1) return null;
    const nodes = tables[0].content;
    const first = nodes.findIndex((node) => node.type !== 'whitespace');
    const specification = nodes[first];
    if (!specification || specification.type !== 'group') return null;
    const spec = toString(specification.content);
    if (!/^[lcr|\s]+$/.test(spec)) return null;
    const columns = [...spec].filter((char) => 'lcr'.includes(char)).length;
    if (!columns || columns > 20) return null;
    const rows = parseAlignEnvironment(
      nodes.slice(first + 1),
      ['&'],
      ['\\', 'hline', 'toprule', 'midrule', 'bottomrule'],
    );
    const result: VisualNode[][][] = [];
    for (const row of rows) {
      if (
        !row.cells.length ||
        (row.cells.length === 1 &&
          row.cells[0].every((node) => node.type === 'whitespace' || node.type === 'comment'))
      )
        continue;
      if (row.cells.length !== columns || result.length >= 100) return null;
      const cells: VisualNode[][] = [];
      for (const cell of row.cells) {
        const raw = toString(cell.filter((node) => node.type !== 'comment')).trim();
        if (!raw) {
          cells.push([]);
          continue;
        }
        const doc = importLatex(raw).doc;
        if (doc.content?.length !== 1 || doc.content[0].type !== 'paragraph') {
          cells.push([{ type: 'text', text: raw }]);
          continue;
        }
        const children = doc.content[0].content ?? [];
        if (children.some((node) => node.type !== 'text' && node.type !== 'inlineMath')) {
          cells.push([{ type: 'text', text: raw }]);
          continue;
        }
        if (
          children.some((node) =>
            (node.marks ?? []).some(
              (mark) =>
                ![
                  'bold',
                  'italic',
                  'underline',
                  'code',
                  'smallCaps',
                  'superscript',
                  'subscript',
                ].includes(mark.type),
            ),
          )
        ) {
          cells.push([{ type: 'text', text: raw }]);
          continue;
        }
        cells.push(children);
      }
      result.push(cells);
    }
    return result.length ? result : null;
  } catch {
    return null;
  }
}

/** Text-only inspection for callers that do not need formatting. */
export function inspectTable(source: string): string[][] | null {
  return (
    parseTablePreview(source)?.map((row) =>
      row.map((cell) =>
        cell
          .map((node) =>
            node.type === 'text' ? (node.text ?? '') : String(node.attrs?.latex ?? ''),
          )
          .join(''),
      ),
    ) ?? null
  );
}

/** Split only adjacent, completely bounded top-level environments separated by whitespace. */
export function splitVisualPreviewBlocks(source: string): string[] | null {
  try {
    const root = parseMinimal(source);
    const blocks: string[] = [];
    let end = 0;
    for (const node of root.content) {
      if (node.type === 'whitespace' || node.type === 'parbreak') continue;
      if (
        node.type !== 'environment' ||
        !['figure', 'figure*', 'table', 'table*', 'tabular'].includes(String(node.env))
      )
        return null;
      const from = node.position?.start?.offset;
      const to = node.position?.end?.offset;
      if (
        typeof from !== 'number' ||
        typeof to !== 'number' ||
        from < end ||
        to <= from ||
        to > source.length ||
        !/^\s*$/.test(source.slice(end, from))
      )
        return null;
      blocks.push(source.slice(from, to));
      end = to;
    }
    return blocks.length > 1 && /^\s*$/.test(source.slice(end)) ? blocks : null;
  } catch {
    return null;
  }
}

function createSingleVisualBlockPreview(
  raw: string,
  projectId: string,
  sourcePath: string,
): { dom: HTMLElement; dispose(): void } | null {
  const figure = inspectFigure(raw);
  const metadata = !figure ? inspectMetadata(raw) : null;
  const table = !figure && !metadata ? parseTablePreview(raw) : null;
  if (!figure && !metadata && !table) return null;
  const dom = document.createElement('div');
  dom.className = 'visual-block-preview';
  dom.contentEditable = 'false';
  let disposed = false;
  let cleanup = () => {};
  if (figure) {
    const label = document.createElement('div');
    label.className = 'visual-block-preview-title';
    label.textContent = figure.caption || figure.target;
    dom.append(label);
    const target = document.createElement('div');
    target.className = 'visual-block-preview-file';
    target.textContent = figure.target;
    if (figure.caption) dom.append(target);
    const candidates = pdfFigureCandidates(figure.target, sourcePath);
    if (candidates.length) {
      const status = document.createElement('div');
      status.className = 'visual-block-preview-status';
      status.textContent = 'Loading PDF figure…';
      dom.append(status);
      void (async () => {
        const result = await resolvePdfFigure(projectId, candidates, () => disposed);
        if (disposed) return;
        if (!result?.ok) {
          status.textContent = 'PDF figure unavailable.';
          return;
        }
        const pdfjs = await import('pdfjs-dist');
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const task = pdfjs.getDocument({
          data: new Uint8Array(result.value),
          enableXfa: false,
          maxImageSize: 16_000_000,
        });
        cleanup = () => {
          void task.destroy();
        };
        const pdf = await task.promise;
        if (disposed) return;
        const page = await pdf.getPage(1);
        if (disposed) return;
        const original = page.getViewport({ scale: 1 });
        const scale = Math.min(
          1.5,
          600 / original.width,
          900 / original.height,
          Math.sqrt(1_000_000 / (original.width * original.height)),
        );
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.setAttribute('aria-label', `First page of ${figure.target}`);
        await page.render({ canvas, viewport }).promise;
        if (!disposed) status.replaceWith(canvas);
      })().catch(() => {
        if (!disposed) status.textContent = 'PDF figure unavailable.';
      });
    }
  } else if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      if (!value) continue;
      const row = document.createElement('div');
      row.textContent = `${key[0].toUpperCase()}${key.slice(1)}: ${value}`;
      dom.append(row);
    }
  } else if (table) {
    const element = document.createElement('table');
    element.setAttribute('aria-label', 'Table preview');
    const tbody = document.createElement('tbody');
    for (const cells of table) {
      const row = document.createElement('tr');
      for (const nodes of cells) {
        const cell = document.createElement('td');
        for (const node of nodes) {
          if (node.type === 'inlineMath') {
            const math = document.createElement('span');
            const latex = String(node.attrs?.renderLatex ?? node.attrs?.latex ?? '');
            try {
              katex.render(latex, math, {
                throwOnError: false,
                trust: false,
                maxSize: 10,
                maxExpand: 100,
                macros: {},
              });
            } catch {
              math.textContent = String(node.attrs?.raw ?? latex);
            }
            cell.append(math);
          } else {
            let element: Node = document.createTextNode(node.text ?? '');
            for (const mark of node.marks ?? []) {
              const tags: Record<string, string> = {
                bold: 'strong',
                italic: 'em',
                underline: 'u',
                code: 'code',
                superscript: 'sup',
                subscript: 'sub',
              };
              const tag = tags[mark.type];
              if (tag || mark.type === 'smallCaps') {
                const wrapper = document.createElement(tag || 'span');
                if (mark.type === 'smallCaps') wrapper.style.fontVariant = 'small-caps';
                wrapper.append(element);
                element = wrapper;
              }
            }
            cell.append(element);
          }
        }
        row.append(cell);
      }
      tbody.append(row);
    }
    element.append(tbody);
    dom.append(element);
  }
  return {
    dom,
    dispose() {
      disposed = true;
      cleanup();
    },
  };
}

/** Create read-only local projections; dispose must be called with the node view. */
export function createVisualBlockPreview(
  raw: string,
  projectId: string,
  sourcePath: string,
): { dom: HTMLElement; dispose(): void } | null {
  const blocks = splitVisualPreviewBlocks(raw);
  if (!blocks) return createSingleVisualBlockPreview(raw, projectId, sourcePath);
  const previews: { dom: HTMLElement; dispose(): void }[] = [];
  for (const block of blocks) {
    const preview = createSingleVisualBlockPreview(block, projectId, sourcePath);
    if (!preview) {
      for (const previous of previews) previous.dispose();
      return null;
    }
    previews.push(preview);
  }
  const dom = document.createElement('div');
  dom.className = 'visual-block-preview-group';
  dom.contentEditable = 'false';
  dom.append(...previews.map((preview) => preview.dom));
  return { dom, dispose: () => previews.forEach((preview) => preview.dispose()) };
}
