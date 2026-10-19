import { describe, expect, it } from 'vitest';
import {
  ARG_HELP,
  addArg,
  classifyArg,
  readOutputLocation,
  toggleArg,
  draftEarlyPasses,
  writeOutputLocation,
} from '../../src/shared/recipe-help';

describe('recipe help', () => {
  it('round-trips the guided output layouts', () => {
    const build = readOutputLocation('build/textra/%RELATIVE_DOC%', '%OUTDIR%');
    expect(build).toEqual({ mode: 'build', folder: 'build/textra', perDocument: true });
    expect(writeOutputLocation(build)).toEqual({
      outDir: 'build/textra/%RELATIVE_DOC%',
      auxDir: '%OUTDIR%',
    });
    const beside = readOutputLocation('%DIR%', 'out/%RELATIVE_DOC%');
    expect(beside).toEqual({ mode: 'beside', folder: 'out', perDocument: true });
    expect(writeOutputLocation({ ...beside, perDocument: false })).toEqual({
      outDir: '%DIR%',
      auxDir: 'out',
    });
  });

  it('treats unusual layouts as custom and never writes an empty folder', () => {
    expect(readOutputLocation('%WORKSPACE_FOLDER%/x', '%OUTDIR%').mode).toBe('custom');
    expect(writeOutputLocation({ mode: 'build', folder: ' ', perDocument: false }).outDir).toBe(
      'build/textra',
    );
  });

  it('toggles options while keeping the document input last', () => {
    const pdflatex = ['-synctex=1', '-output-directory=%OUTDIR%', '%DOC_EXT%'];
    const halt = ARG_HELP.engine.find((entry) => entry.arg === '-halt-on-error')!;
    const on = toggleArg(pdflatex, 'engine', halt);
    expect(on).toEqual(['-synctex=1', '-output-directory=%OUTDIR%', '-halt-on-error', '%DOC_EXT%']);
    expect(toggleArg(on, 'engine', halt)).toEqual(pdflatex);
    expect(addArg([], '-x')).toEqual(['-x']);
  });

  it('keeps latexmk modes exclusive and classifies arguments', () => {
    const pdf = ARG_HELP.latexmk.find((entry) => entry.arg === '-pdf')!;
    const xe = ARG_HELP.latexmk.find((entry) => entry.arg === '-pdfxe')!;
    expect(toggleArg(toggleArg(['%DOC_EXT%'], 'latexmk', pdf), 'latexmk', xe)).toEqual([
      '-pdfxe',
      '%DOC_EXT%',
    ]);
    expect(classifyArg('-outdir=%OUTDIR%', 'latexmk')).toBe('managed');
    expect(classifyArg('%DOC_EXT%', 'engine')).toBe('input');
    expect(classifyArg('-bogus', 'engine')).toBe('custom');
  });

  it('uses draft copies of the compiler for every pass but the last', () => {
    const tools = [
      { name: 'pdflatex', command: 'pdflatex', args: ['-synctex=1', '%DOC_EXT%'] },
      { name: 'bibtex', command: 'bibtex', args: ['%DOCFILE%'] },
    ];
    const result = draftEarlyPasses(['pdflatex', 'bibtex', 'pdflatex', 'pdflatex'], tools);
    expect(result.steps).toEqual(['pdflatex-draft', 'bibtex', 'pdflatex-draft', 'pdflatex']);
    expect(result.tools.find((tool) => tool.name === 'pdflatex-draft')!.args).toEqual([
      '-synctex=1',
      '-draftmode',
      '%DOC_EXT%',
    ]);
    expect(result.tools).toHaveLength(3);
    expect(draftEarlyPasses(['pdflatex'], tools).steps).toEqual(['pdflatex']);
  });
});
