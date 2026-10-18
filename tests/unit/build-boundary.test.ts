import { describe, expect, it } from 'vitest';
import { BuildService, findExecutable } from '../../src/main/services/latex';
import type { BuildEngine } from '../../src/shared/api';

describe('build command boundary', () => {
  it('rejects unsupported tool names instead of running arbitrary executables', async () => {
    await expect(findExecutable('powershell')).rejects.toThrow();
    await expect(findExecutable('pdflatex; touch injected')).rejects.toThrow();
  });

  it.each([
    '../outside.tex',
    '/etc/passwd.tex',
    'C:/outside.tex',
    '-shell-escape.tex',
    'main.bib',
    'a\\b.tex',
  ])('rejects unsafe root document: %s', async (rootFile) => {
    const service = new BuildService(() => {
      throw new Error('Root lookup should not be reached.');
    });
    await expect(
      service.compile({ projectId: 'test', rootFile, engine: 'pdflatex' }),
    ).rejects.toThrow();
    expect(service.getState().running).toBe(false);
  });

  it('rejects a stale project and an unsupported engine before a process can start', async () => {
    const service = new BuildService(() => {
      throw new Error('Stale project.');
    });
    await expect(
      service.compile({ projectId: 'stale', rootFile: 'main.tex', engine: 'pdflatex' }),
    ).rejects.toThrow('Stale project.');
    await expect(
      service.compile({ projectId: 'test', rootFile: 'main.tex', engine: 'shell' as BuildEngine }),
    ).rejects.toThrow('Invalid build request.');
    expect(service.getState().outcome).toBe('idle');
  });

  it('does not expose mutable state or arbitrary PDFs before a successful build', async () => {
    const service = new BuildService(() => process.cwd());
    const state = service.getState();
    state.log = 'Mutated by caller.';
    state.diagnostics.push({ severity: 'error', message: 'Injected.' });
    expect(service.getState().log).toBe('');
    expect(service.getState().diagnostics).toEqual([]);
    await expect(service.readPdf({ projectId: 'test', path: 'private.pdf' })).rejects.toThrow();
  });
});
