import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findExecutable } from '../../src/main/services/latex';
import { setToolPaths, validateToolPath } from '../../src/main/services/tool-paths';

describe('custom tool paths', () => {
  afterEach(() => setToolPaths({}));

  it('uses a valid override instead of searching PATH', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'textra-tool-'));
    try {
      const file = join(directory, process.platform === 'win32' ? 'bibtex.exe' : 'bibtex');
      await writeFile(file, '');
      setToolPaths({ bibtex: file });
      expect(await findExecutable('bibtex')).toBe(await realpath(file));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reports a stale override as missing rather than falling back to PATH', async () => {
    const missing = join(
      tmpdir(),
      'textra-missing',
      process.platform === 'win32' ? 'synctex.exe' : 'synctex',
    );
    setToolPaths({ synctex: missing });
    expect(await findExecutable('synctex')).toBeNull();
  });

  it('does not accept a directory as an executable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'textra-tool-'));
    try {
      setToolPaths({ biber: directory });
      expect(await findExecutable('biber')).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('requires the file name to match the tool', () => {
    expect(() => validateToolPath('pdflatex', '/opt/tex/xelatex')).toThrow();
    expect(() => validateToolPath('pdflatex', 'relative/pdflatex')).toThrow();
    expect(validateToolPath('pdflatex', '/opt/tex/pdflatex')).toBe('/opt/tex/pdflatex');
  });
});
