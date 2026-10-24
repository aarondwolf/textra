import { isValidElement, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from '../../icons';
import './markdown.css';

export interface MarkdownPreviewProps {
  /** Markdown source to display. It is always rendered as text/React nodes, never HTML. */
  source: string;
  /** Optional label shown above the preview, normally the file's project-relative path. */
  path?: string;
  className?: string;
  /** Show an always-visible copy control on fenced code blocks. */
  copyCode?: boolean;
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

export type MarkdownBlock = ListBlock | TextBlock;

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const UNORDERED_ITEM = /^\s*[-*+]\s+(.+)$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.+)$/;
const FENCE = /^\s*```([^`]*)$/;

/**
 * CommonMark-inspired block parser preserved for backward compatibility and test contracts.
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

export function safeHref(candidate: string): string | null {
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

/** Legacy inline renderer preserved for backward compatibility and test contracts. */
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

function CodePreBlock({ children, copyCode }: { children?: ReactNode; copyCode: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  let codeText = '';
  let language: string | undefined;

  if (isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    const rawClass = children.props.className || '';
    const match = /language-(\w+)/.exec(rawClass);
    if (match) language = match[1];
    const rawContent = children.props.children;
    codeText =
      typeof rawContent === 'string'
        ? rawContent.replace(/\n$/, '')
        : String(rawContent ?? '').replace(/\n$/, '');
  } else if (typeof children === 'string') {
    codeText = children.replace(/\n$/, '');
  }

  return (
    <div className="markdown-preview-code-wrap">
      <pre className="markdown-preview-code" data-language={language}>
        <code>{codeText}</code>
      </pre>
      {copyCode && (
        <>
          <button
            className="markdown-preview-code-copy"
            type="button"
            aria-label={copied ? 'Copied code' : 'Copy code'}
            title={copied ? 'Copied' : 'Copy code'}
            onClick={() => {
              setCopyError('');
              void window.textra
                .copyText(codeText)
                .then((result) => {
                  if (result.ok) setCopied(true);
                  else setCopyError(result.error);
                })
                .catch(() => setCopyError('Could not copy this code. Try again.'));
            }}
          >
            {copied ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
            )}
          </button>
          {copyError && (
            <span role="alert" className="markdown-preview-copy-error">
              {copyError}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Rich, secure Markdown preview using react-markdown and remark-gfm.
 * Supports GFM tables, task lists, nested lists, blockquotes, and code copying with safe URLs.
 */
export function MarkdownPreview({ source, className, copyCode = false }: MarkdownPreviewProps) {
  if (!source.trim()) {
    return (
      <section
        className={`markdown-preview${className ? ` ${className}` : ''}`}
        aria-label="Markdown preview"
      >
        <div className="markdown-preview-body">
          <p className="markdown-preview-empty">Nothing to preview.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`markdown-preview${className ? ` ${className}` : ''}`}
      aria-label="Markdown preview"
    >
      <div className="markdown-preview-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              const safe = href ? safeHref(href) : null;
              return safe ? (
                <a href={safe} rel="noreferrer noopener" target="_blank">
                  {children}
                </a>
              ) : (
                <span>{children}</span>
              );
            },
            pre: ({ children }) => <CodePreBlock copyCode={copyCode}>{children}</CodePreBlock>,
          }}
        >
          {source}
        </ReactMarkdown>
      </div>
    </section>
  );
}
