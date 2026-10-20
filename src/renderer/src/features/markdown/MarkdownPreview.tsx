import { Fragment, type ReactNode } from 'react';
import './markdown.css';

export interface MarkdownPreviewProps {
  /** Markdown source to display. It is always rendered as text/React nodes, never HTML. */
  source: string;
  /** Optional label shown above the preview, normally the file's project-relative path. */
  path?: string;
  className?: string;
}

type ListKind = 'ordered' | 'unordered';

interface ListBlock {
  kind: 'list';
  listKind: ListKind;
  items: string[];
}

interface TextBlock {
  kind: 'paragraph' | 'heading' | 'code';
  text: string;
  level?: number;
  language?: string;
}

type MarkdownBlock = ListBlock | TextBlock;

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const UNORDERED_ITEM = /^\s*[-*+]\s+(.+)$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.+)$/;
const FENCE = /^\s*```([^`]*)$/;

/**
 * Small CommonMark-inspired block parser for the in-app preview. Deliberately no raw HTML
 * support: keeping this representation as strings makes rendering safe by construction.
 */
export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', language: fence[1]?.trim(), text: code.join('\n') });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' });
      index += 1;
      continue;
    }

    const unordered = line.match(UNORDERED_ITEM);
    const ordered = line.match(ORDERED_ITEM);
    if (unordered || ordered) {
      const listKind: ListKind = unordered ? 'unordered' : 'ordered';
      const itemPattern = listKind === 'unordered' ? UNORDERED_ITEM : ORDERED_ITEM;
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(itemPattern);
        if (!item) break;
        items.push(item[1] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'list', listKind, items });
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? '';
      if (
        !next.trim() ||
        FENCE.test(next) ||
        HEADING.test(next) ||
        UNORDERED_ITEM.test(next) ||
        ORDERED_ITEM.test(next)
      ) {
        break;
      }
      paragraph.push(next.trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

function safeHref(candidate: string): string | null {
  const href = candidate.trim();
  if (
    !href ||
    [...href].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  )
    return null;
  if (/^(https?:|mailto:)/i.test(href) || /^[#/.]/.test(href)) return href;
  return null;
}

/** Renders the small inline subset without using HTML injection. */
export function renderMarkdownInline(source: string): ReactNode[] {
  const pattern =
    /(`[^`]*`)|(\[[^\]]+\]\([^\s)]+\))|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)/g;
  const nodes: ReactNode[] = [];
  let position = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > position) nodes.push(source.slice(position, match.index));
    const token = match[0];
    const tokenKey = `inline-${key++}`;
    if (match[1]) {
      nodes.push(<code key={tokenKey}>{token.slice(1, -1)}</code>);
    } else if (match[2]) {
      const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(token);
      const label = link?.[1] ?? token;
      const href = link ? safeHref(link[2] ?? '') : null;
      nodes.push(
        href ? (
          <a href={href} key={tokenKey} rel="noreferrer noopener" target="_blank">
            {label}
          </a>
        ) : (
          <span key={tokenKey}>{label}</span>
        ),
      );
    } else if (match[3]) {
      nodes.push(<strong key={tokenKey}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={tokenKey}>{token.slice(1, -1)}</em>);
    }
    position = match.index + token.length;
  }
  if (position < source.length) nodes.push(source.slice(position));
  return nodes;
}

function Block({ block }: { block: MarkdownBlock }) {
  if (block.kind === 'code') {
    return (
      <pre className="markdown-preview-code" data-language={block.language || undefined}>
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === 'list') {
    const List = block.listKind === 'ordered' ? 'ol' : 'ul';
    return (
      <List>
        {block.items.map((item, index) => (
          <li key={`${index}-${item}`}>{renderMarkdownInline(item)}</li>
        ))}
      </List>
    );
  }
  if (block.kind === 'heading') {
    const Heading = `h${block.level ?? 1}` as keyof React.JSX.IntrinsicElements;
    return <Heading>{renderMarkdownInline(block.text)}</Heading>;
  }
  return <p>{renderMarkdownInline(block.text)}</p>;
}

/** A dependency-free, read-only Markdown preview intended for project documentation. */
export function MarkdownPreview({ source, path, className }: MarkdownPreviewProps) {
  const blocks = parseMarkdownBlocks(source);
  return (
    <section
      className={`markdown-preview${className ? ` ${className}` : ''}`}
      aria-label="Markdown preview"
    >
      {path && <div className="markdown-preview-path">Previewing {path}</div>}
      <div className="markdown-preview-body">
        {blocks.length ? (
          blocks.map((block, index) => (
            <Fragment key={`${block.kind}-${index}`}>
              <Block block={block} />
            </Fragment>
          ))
        ) : (
          <p className="markdown-preview-empty">Nothing to preview.</p>
        )}
      </div>
    </section>
  );
}
