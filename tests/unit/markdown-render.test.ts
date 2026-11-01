import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview } from '../../src/renderer/src/features/markdown/MarkdownPreview';

describe('MarkdownPreview', () => {
  it('does not render raw HTML or unsafe links', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        source: '<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert(1))',
      }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('href="javascript:');
  });
  it('renders fenced code and inline emphasis as formatted markup', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        source: 'Here is **code**:\n\n```tex\n\\usepackage{lipsum}\n```',
        className: 'ai-message-markdown',
      }),
    );
    expect(html).toContain('<strong>code</strong>');
    expect(html).toContain('<pre class="markdown-preview-code" data-language="tex">');
    expect(html).toContain('<code>\\usepackage{lipsum}</code>');
  });

  it('shows an always-visible copy control for fenced code when enabled', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownPreview, {
        source: '```tex\n\\usepackage{lipsum}\n```',
        copyCode: true,
      }),
    );
    expect(html).toContain('aria-label="Copy code"');
    expect(html).not.toContain('title="Copy code"');
    expect(html).toContain('<code>\\usepackage{lipsum}</code>');
  });
});
