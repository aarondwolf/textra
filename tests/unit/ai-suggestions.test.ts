import { describe, expect, it } from 'vitest';
import { hasSuggestedFix } from '../../src/shared/ai-suggestions';

describe('explicit suggested-fix marker', () => {
  it.each([
    '**Suggested fix:** Replace `\\bad` with `\\textbf`.',
    '**Suggested fix**: Add the missing brace.',
    '__Suggested fix:__ Close the environment.',
    'Suggested fix: Add a closing dollar sign.',
    '### Suggested fix\n\nUse `\\textit{hello}`.',
    '## **Suggested fix** ##\n```latex\n\\end{document}\n```',
    '# SUGGESTED FIX:\nAdd the package.',
  ])('recognizes a labelled, nonempty correction: %s', (source) => {
    expect(hasSuggestedFix(source)).toBe(true);
  });

  it.each([
    'Try fixing the LaTeX syntax.',
    'The phrase Suggested fix: appears in this explanation.',
    'Suggested fixes include adding packages.',
    '**Suggested fix:**',
    '### Suggested fix\n\n## Explanation\nNo correction was provided.',
    'Suggested fix:\n```latex\n```',
    '```markdown\n**Suggested fix:** This is an example marker.\n```',
    '~~~\nSuggested fix: This is quoted source.\n~~~',
    '````markdown\n```\n**Suggested fix:** This remains quoted source.\n````',
  ])('does not infer a fix from generic prose, an empty section or code: %s', (source) => {
    expect(hasSuggestedFix(source)).toBe(false);
  });
});
