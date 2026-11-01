import { isValidElement, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from '../../icons';
import { TooltipButton } from '../../components/Button';
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
          <TooltipButton
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
          </TooltipButton>
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
