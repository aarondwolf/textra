import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultRecipeSettings } from '../../src/shared/recipes';
import { planRecipe, recipeArguments, recipeDirectory } from '../../src/main/services/recipe-plan';
import { BuildService } from '../../src/main/services/latex';

describe('configured recipe execution boundary', () => {
  let root: string;
  beforeEach(async () => {
    const parent = join(process.cwd(), '.test-data', 'recipe-unit');
    await mkdir(parent, { recursive: true });
    root = await mkdtemp(join(parent, 'case-'));
    await writeFile(join(root, 'main.tex'), '\\documentclass{article}\n');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it.each([
    '-shell-escape',
    '--enable-write18',
    '-e=system("bad")',
    '-r=project.rc',
    '-pdflatex=evil',
    '-fmt=evil',
    '-ini',
    '-jobname=../../outside',
    '-shell-restricted',
  ])('rejects unsafe compiler options: %s', async (argument) => {
    const settings = createDefaultRecipeSettings();
    settings['latex-workshop.latex.tools'][0]!.args.unshift(argument);
    if (argument.startsWith('-jobname')) {
      await expect(planRecipe(root, 'main.tex', 'pdflatex', settings)).rejects.toThrow();
    } else {
      const plan = await planRecipe(root, 'main.tex', 'pdflatex', settings);
      expect(() => recipeArguments(plan.steps[0]!, plan, true)).toThrow(/unsafe|Unsupported/);
    }
  });

  it('accepts Workshop argument arrays, spaces and Unicode without shell quoting', async () => {
    await mkdir(join(root, 'résumé sources'));
    await writeFile(join(root, 'résumé sources', 'my document.tex'), '');
    const plan = await planRecipe(
      root,
      'résumé sources/my document.tex',
      'pdflatex',
      createDefaultRecipeSettings(),
    );
    const args = recipeArguments(plan.steps[0]!, plan, true);
    expect(args).toContain(join(root, 'résumé sources', 'my document.tex').replaceAll('\\', '/'));
    expect(args).toContain('-disable-write18');
    expect(args).toContain('-dont-parse-first-line');
    expect(args).toContain('-disable-installer');
    expect(plan.output).toBe(join(root, 'build', 'textra', 'résumé sources', 'my document'));
    expect(plan.steps[0]!.cwd).toBe(join(root, 'résumé sources'));
  });

  it('separates identically named documents with relative Workshop placeholders', async () => {
    await mkdir(join(root, 'chapter one'));
    await mkdir(join(root, 'chapter two'));
    const settings = createDefaultRecipeSettings();
    settings['latex-workshop.latex.outDir'] = 'build/textra/%RELATIVE_DOC%';
    settings['latex-workshop.latex.tools'][0]!.cwd = '%WORKSPACE_FOLDER%/%RELATIVE_DIR%';
    const first = await planRecipe(root, 'chapter one/main.tex', 'pdflatex', settings);
    const second = await planRecipe(root, 'chapter two/main.tex', 'pdflatex', settings);
    expect(first.output).toBe(join(root, 'build', 'textra', 'chapter one', 'main'));
    expect(second.output).toBe(join(root, 'build', 'textra', 'chapter two', 'main'));
    expect(first.output).not.toBe(second.output);
    expect(first.steps[0]!.cwd).toBe(join(root, 'chapter one'));
  });

  it.each(['../outside', '.git/generated', '.textra/generated', 'node_modules/generated'])(
    'rejects escaped/protected output path %s',
    async (directory) => {
      const settings = createDefaultRecipeSettings();
      settings['latex-workshop.latex.outDir'] = directory;
      await expect(planRecipe(root, 'main.tex', 'pdflatex', settings)).rejects.toThrow();
    },
  );

  it('rejects unknown placeholders and executable/env substitutions', async () => {
    const settings = createDefaultRecipeSettings();
    settings['latex-workshop.latex.tools'][0]!.args.push('%UNKNOWN%');
    await expect(planRecipe(root, 'main.tex', 'pdflatex', settings)).rejects.toThrow('placeholder');
    settings['latex-workshop.latex.tools'][0]!.args.pop();
    settings['latex-workshop.latex.tools'][0]!.command = 'powershell';
    await expect(planRecipe(root, 'main.tex', 'pdflatex', settings)).rejects.toThrow('TeX command');
    settings['latex-workshop.latex.tools'][0]!.command = 'pdflatex';
    settings['latex-workshop.latex.tools'][0]!.env = { PATH: root };
    await expect(planRecipe(root, 'main.tex', 'pdflatex', settings)).rejects.toThrow('env');
    settings['latex-workshop.latex.tools'][0]!.env = { TEXINPUTS: '../outside' };
    await expect(planRecipe(root, 'main.tex', 'pdflatex', settings)).rejects.toThrow('inside');
  });

  it('permits project-local recursive TeX search paths and root output', async () => {
    const settings = createDefaultRecipeSettings();
    settings['latex-workshop.latex.outDir'] = '.';
    settings['latex-workshop.latex.tools'][0]!.env = {
      TEXINPUTS: '%DIR%//;'.replace(';', process.platform === 'win32' ? ';' : ':'),
    };
    const plan = await planRecipe(root, 'main.tex', 'pdflatex', settings);
    expect(plan.output).toBe(root);
    expect(plan.steps[0]!.env.TEXINPUTS).toContain(root + '//');
    expect(() => recipeArguments(plan.steps[0]!, plan, true)).not.toThrow();
  });

  it('rejects auxiliary separation for unsupported engines with an explicit explanation', async () => {
    const settings = createDefaultRecipeSettings();
    settings['latex-workshop.latex.auxDir'] = 'build/auxiliary';
    const plan = await planRecipe(root, 'main.tex', 'pdflatex', settings);
    expect(() => recipeArguments(plan.steps[0]!, plan, false)).toThrow('direct MiKTeX');
    expect(recipeArguments(plan.steps[0]!, plan, true)).toContain(
      `-aux-directory=${plan.auxiliary}`,
    );
  });

  it('rejects alternate source input and a tool-level output override', async () => {
    const settings = createDefaultRecipeSettings();
    const tool = settings['latex-workshop.latex.tools'][0]!;
    tool.args = ['-output-directory=%DIR%', '%DOC_EXT%'];
    let plan = await planRecipe(root, 'main.tex', 'pdflatex', settings);
    expect(() => recipeArguments(plan.steps[0]!, plan, true)).toThrow('configured');
    tool.args = ['\\input{secret}', '%DOC_EXT%'];
    plan = await planRecipe(root, 'main.tex', 'pdflatex', settings);
    expect(() => recipeArguments(plan.steps[0]!, plan, true)).toThrow('active document');
  });

  it('forces latexmk to ignore rc files and regenerate output', async () => {
    const plan = await planRecipe(root, 'main.tex', 'latexmk', createDefaultRecipeSettings());
    const args = recipeArguments(plan.steps[0]!, plan, false);
    expect(args).toContain('-norc');
    expect(args).toContain('-g');
    expect(args).toContain('-latexoption=-no-shell-escape');
  });

  it('rejects missing recipe settings without starting a process', async () => {
    const service = new BuildService(() => root);
    const result = await service.compile({
      projectId: 'project',
      rootFile: 'main.tex',
      engine: 'pdflatex',
      recipe: 'pdflatex',
    });
    expect(result.outcome).toBe('failed');
    expect(result.log).toContain('settings are required');
    expect(result.log).not.toContain('> ');
  });

  it('checks existing directories, including the project root', async () => {
    expect(await recipeDirectory(root, root)).toBe(root);
    await expect(recipeDirectory(root, join(root, 'main.tex'))).rejects.toThrow('links');
  });
});
