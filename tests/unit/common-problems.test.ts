import { describe, expect, it } from 'vitest';
import { commonProblemHelp } from '../../src/shared/common-problems';

describe('common TeX problem help', () => {
  it.each([
    'Undefined control sequence.',
    'Missing $ inserted.',
    'Overfull \\hbox (12pt too wide)',
    'Underfull \\hbox (badness 10000)',
    'Runaway argument?',
    'LaTeX Error: File `sample.sty` not found.',
    'LaTeX Error: Missing \\begin{document}.',
    'LaTeX Error: Can be used only in preamble.',
    'Extra }, or forgotten $.',
    'LaTeX Error: Environment example undefined.',
    'Emergency stop.',
  ])('explains familiar compiler errors: %s', (message) => {
    const help = commonProblemHelp(message);
    expect(help).not.toBeNull();
    expect(help?.title).toBeTruthy();
    expect(help?.explanation).toBeTruthy();
    expect(help?.url).toMatch(
      /^https:\/\/(texfaq\.org\/FAQ-|www\.overleaf\.com\/(learn|how-to)\/)/,
    );
    expect(['TeX FAQ', 'Overleaf']).toContain(help?.sourceLabel);
  });

  it('does not guess for unrelated diagnostics', () => {
    expect(commonProblemHelp('A custom package emitted a nonstandard message.')).toBeNull();
  });
});
