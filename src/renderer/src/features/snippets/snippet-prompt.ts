/** Build a portable prompt for generating a custom LaTeX editor snippet. */
export function createSnippetPrompt(name: string, description: string): string {
  const details = [
    name.trim() ? `The snippet should be named "${name.trim()}".` : '',
    description.trim() ? `Its purpose is: ${description.trim()}` : '',
  ].filter(Boolean);

  return [
    'Create a reusable custom snippet for a LaTeX editor.',
    'Return only the LaTeX code that belongs in the snippet, with no explanation or Markdown fences.',
    'Use $0 as the final cursor position or tab stop. Place it where the user should continue typing; omit it only if no cursor position is useful.',
    'Preserve LaTeX commands and backslashes literally. Keep braces and environments balanced.',
    ...details,
    '',
    'Here is what I want in the snippet:',
    '',
  ].join('\n');
}
