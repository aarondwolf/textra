import { describe, expect, it } from 'vitest';
import { commonProblemHelp } from '../../src/shared/common-problems';

describe('common TeX problem help', () => {
  it.each([
    'Undefined control sequence.',
    'Missing $ inserted.',
    'Overfull \\hbox (12pt too wide)',
    'Runaway argument?',
    'Emergency stop.',
  ])('explains familiar compiler errors: %s', (message) => {
    expect(commonProblemHelp(message)).not.toBeNull();
  });

  it('does not guess for unrelated diagnostics', () => {
    expect(commonProblemHelp('A custom package emitted a nonstandard message.')).toBeNull();
  });
});
