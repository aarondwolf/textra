import { describe, expect, it } from 'vitest';
import { validateRelativePath } from '../../src/main/services/projects';

describe('portable relative project path boundary', () => {
  it.each([
    'main.tex',
    'chapters/introduction.tex',
    'résumé/notes with spaces.tex',
    'references.bib',
  ])('accepts an ordinary portable path: %s', (path) =>
    expect(validateRelativePath(path)).toBe(path),
  );

  it.each([
    null,
    42,
    '',
    '/etc/passwd',
    '../outside.tex',
    'chapters/../../outside.tex',
    'chapters/./main.tex',
    'chapters//main.tex',
    'C:/outside.tex',
    'C:\\outside.tex',
    'chapters\\main.tex',
    '//server/share/main.tex',
    'main.tex:secret',
    'main\u0000.tex',
    '.git/config',
    '.textra/project.json',
    'node_modules/package/index.js',
    'main.aux',
  ])('rejects malformed, protected, or escaping path: %j', (value) => {
    expect(() => validateRelativePath(value)).toThrow();
  });
});
