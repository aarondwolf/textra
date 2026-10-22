import { describe, expect, it } from 'vitest';
import { createSnippetPrompt } from '../../src/renderer/src/features/snippets/snippet-prompt';

describe('custom snippet prompt', () => {
  it('explains code-only output and the cursor placeholder, ending with an editable request', () => {
    const prompt = createSnippetPrompt('Theorem', 'A theorem block');
    expect(prompt).toContain('only the LaTeX code');
    expect(prompt).toContain('$0 as the final cursor position');
    expect(prompt).toContain('The snippet should be named "Theorem".');
    expect(prompt).toContain('Its purpose is: A theorem block');
    expect(prompt.endsWith('Here is what I want in the snippet:\n')).toBe(true);
  });

  it('ends with the request prompt even when optional details are blank', () => {
    expect(createSnippetPrompt('', '')).toMatch(/Here is what I want in the snippet:\n$/);
  });
});
