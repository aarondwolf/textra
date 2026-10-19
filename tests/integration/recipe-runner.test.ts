import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildService, detectTools } from '../../src/main/services/latex';
import { createDefaultRecipeSettings } from '../../src/shared/recipes';
import type { ToolInfo } from '../../src/shared/api';

describe('real configured Workshop recipes', () => {
  let tools: ToolInfo[];
  let directory: string;
  let root: string;
  let service: BuildService;
  const projectId = 'configured-recipes';
  const request = {
    projectId,
    rootFile: 'main.tex',
    engine: 'pdflatex' as const,
    recipe: 'pdflatex',
  };
  beforeAll(async () => {
    tools = await detectTools();
  }, 60000);
  beforeEach(async () => {
    const parent = join(process.cwd(), '.test-data', 'recipe-integration');
    await mkdir(parent, { recursive: true });
    directory = await mkdtemp(join(parent, 'case-'));
    root = join(directory, 'résumé project with spaces');
    await mkdir(root);
    service = new BuildService(() => root, 20000);
    await cp(join(process.cwd(), 'tests', 'fixtures', 'minimal article'), root, {
      recursive: true,
    });
  });
  afterEach(async () => {
    await service.cancel();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const has = (name: string) => tools.some((tool) => tool.name === name && tool.path);

  it('builds editable output paths and maps SyncTeX while retaining the last successful bytes on failure', async (context) => {
    if (!has('pdflatex')) context.skip('A usable pdflatex installation is unavailable.');
    const settings = createDefaultRecipeSettings();
    settings['latex-workshop.latex.outDir'] = 'PDF output/%DOCFILE%';
    const result = await service.compile(request, settings);
    expect(result.outcome, result.log).toBe('success');
    expect(result.pdfPath).toBe('PDF output/main/main.pdf');
    const repeated = await service.compile(request, settings);
    expect(repeated.outcome, repeated.log).toBe('success');
    expect(repeated.pdfPath).toBe(result.pdfPath);
    expect(repeated.pdfVersion).toBeGreaterThan(result.pdfVersion!);
    const original = await service.readPdf({ projectId, path: result.pdfPath! });
    expect(Buffer.from(original).subarray(0, 5).toString()).toBe('%PDF-');
    if (has('synctex')) {
      const location = await service.syncForward({
        projectId,
        rootFile: 'main.tex',
        path: 'main.tex',
        line: 8,
      });
      expect(location.page).toBeGreaterThan(0);
      const inverse = await service.syncInverse({ projectId, rootFile: 'main.tex', ...location });
      expect(inverse.path).toBe('main.tex');
    }
    await writeFile(
      join(root, 'main.tex'),
      '\\documentclass{article}\n\\begin{document}\\invalidcommand\\end{document}',
    );
    const failed = await service.compile(request, settings);
    expect(failed.outcome).toBe('failed');
    expect(failed.pdfVersion).toBe(repeated.pdfVersion);
    expect(await service.readPdf({ projectId, path: result.pdfPath! })).toEqual(original);
  }, 60000);

  it('runs the configured ordered bibliography steps against source includes', async (context) => {
    if (!has('pdflatex') || !has('bibtex')) context.skip('Usable pdflatex/BibTeX is unavailable.');
    await cp(join(process.cwd(), 'tests', 'fixtures', 'dissertation'), root, { recursive: true });
    const result = await service.compile(
      { ...request, recipe: 'bibtex-pipeline' },
      createDefaultRecipeSettings(),
    );
    expect(result.outcome, result.log).toBe('success');
    expect(result.log.match(/> pdflatex/g)?.length).toBe(3);
    expect(result.log.match(/> bibtex/g)?.length).toBe(1);
    expect(await readFile(join(root, 'build', 'textra', 'main', 'main.bbl'), 'utf8')).toContain(
      'knuth1984',
    );
  }, 60000);

  it('supports separate auxiliary output with a direct MiKTeX engine', async (context) => {
    if (!has('pdflatex')) context.skip('A usable pdflatex installation is unavailable.');
    const settings = createDefaultRecipeSettings();
    settings['latex-workshop.latex.auxDir'] = 'Auxiliary output/%DOCFILE%';
    const result = await service.compile(request, settings);
    if (result.outcome === 'failed' && result.log.includes('require a direct MiKTeX engine'))
      context.skip('Separate auxiliary output requires MiKTeX.');
    expect(result.outcome, result.log).toBe('success');
    expect(await readFile(join(root, 'Auxiliary output', 'main', 'main.aux'), 'utf8')).toContain(
      'relax',
    );
    if (has('synctex')) {
      const location = await service.syncForward({
        projectId,
        rootFile: 'main.tex',
        path: 'main.tex',
        line: 8,
      });
      expect(location.page).toBeGreaterThan(0);
    }
  }, 60000);

  it('does not count a stale PDF as success for a draft-only recipe', async (context) => {
    if (!has('pdflatex')) context.skip('A usable pdflatex installation is unavailable.');
    const settings = createDefaultRecipeSettings();
    expect((await service.compile(request, settings)).outcome).toBe('success');
    settings['latex-workshop.latex.tools'][0]!.args.unshift('-draftmode');
    const result = await service.compile(request, settings);
    expect(result.outcome, result.log).toBe('failed');
    expect(result.log).toContain('fresh PDF');
  }, 60000);

  it('cancels the active configured recipe process', async (context) => {
    if (!has('pdflatex')) context.skip('A usable pdflatex installation is unavailable.');
    await writeFile(
      join(root, 'main.tex'),
      '\\documentclass{article}\n\\begin{document}\n\\loop\\iftrue\\repeat\n\\end{document}',
    );
    const running = service.compile(request, createDefaultRecipeSettings());
    await vi.waitFor(() => expect(service.getState().log).toContain('> pdflatex'), {
      timeout: 12000,
    });
    await service.cancel();
    const result = await running;
    expect(result.outcome, result.log).toBe('cancelled');
    expect(result.running).toBe(false);
  }, 30000);
});
