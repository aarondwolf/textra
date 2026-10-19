import { lstat, mkdir, realpath } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { validateRecipeSettings, type RecipeSettings } from '../../shared/recipes';

export interface RecipeStep {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}
export interface RecipePlan {
  root: string;
  document: string;
  output: string;
  auxiliary: string;
  pdf: string;
  jobName: string;
  steps: RecipeStep[];
}

const hasControlCharacters = (value: string) =>
  [...value].some((character) => character.charCodeAt(0) < 32);

/** Resolve every component independently, rejecting links even when they point inside the project. */
export async function recipeDirectory(
  root: string,
  value: string,
  create = false,
): Promise<string> {
  if (!value || hasControlCharacters(value)) throw new Error('Invalid recipe directory.');
  const absolute = resolve(root, value);
  const inside = relative(root, absolute);
  if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
    throw new Error('Recipe directories must stay inside the selected project.');
  if (!isAbsolute(value) && value.split(/[\\/]/).includes('..'))
    throw new Error('Recipe directories cannot contain parent traversal.');
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error('The project folder changed or contains a link.');
  let current = root;
  for (const part of inside ? inside.split(sep) : []) {
    if (
      ['.git', '.textra', 'node_modules', '.agents', '.codex'].includes(part.toLowerCase()) ||
      /[. ]$/.test(part) ||
      /[<>:"|?*]/.test(part) ||
      /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(part)
    )
      throw new Error('Recipe directory uses a protected or invalid name.');
    current = join(current, part);
    if (create) {
      try {
        await mkdir(current);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(current)) !== current)
      throw new Error('Recipe directories cannot contain links.');
  }
  return absolute;
}

function expand(value: string, replacements: Record<string, string>): string {
  return value.replace(/%[^%]*%/g, (placeholder) => {
    const key = placeholder.slice(1, -1);
    const normalized = key.replace(/_W32$/, '');
    const replacement = replacements[normalized];
    if (replacement === undefined)
      throw new Error(`Unsupported recipe placeholder: ${placeholder}`);
    return key.endsWith('_W32') && process.platform === 'win32'
      ? replacement.replaceAll('/', '\\')
      : replacement.replaceAll('\\', '/');
  });
}

export async function planRecipe(
  root: string,
  rootFile: string,
  name: string,
  rawSettings: RecipeSettings,
): Promise<RecipePlan> {
  const settings = validateRecipeSettings(rawSettings);
  const recipe = settings['latex-workshop.latex.recipes'].find(
    (candidate) => candidate.name === name,
  );
  if (!recipe) throw new Error(`Recipe "${name}" does not exist. Choose a recipe in Settings.`);
  const document = resolve(root, rootFile);
  const documentName = basename(document).replace(/\.tex$/i, '');
  const replacements: Record<string, string> = {
    DOC: document.replace(/\.tex$/i, ''),
    DOC_EXT: document,
    DOCFILE: documentName,
    DOCFILE_EXT: basename(document),
    DIR: dirname(document),
    RELATIVE_DIR: relative(root, dirname(document)).split(sep).join('/'),
    RELATIVE_DOC: relative(root, document)
      .replace(/\.tex$/i, '')
      .split(sep)
      .join('/'),
    WORKSPACE_FOLDER: root,
  };
  const output = await recipeDirectory(
    root,
    expand(settings['latex-workshop.latex.outDir'], replacements),
    true,
  );
  replacements.OUTDIR = output;
  const auxiliary = await recipeDirectory(
    root,
    expand(settings['latex-workshop.latex.auxDir'], replacements),
    true,
  );
  replacements.AUXDIR = auxiliary;
  const steps: RecipeStep[] = [];
  for (const toolName of recipe.tools) {
    const tool = settings['latex-workshop.latex.tools'].find(
      (candidate) => candidate.name === toolName,
    )!;
    const command = tool.command.toLowerCase().replace(/\.exe$/, '');
    const cwd = await recipeDirectory(
      root,
      expand(
        tool.cwd ?? (['bibtex', 'biber'].includes(command) ? '%AUXDIR%' : '%DIR%'),
        replacements,
      ),
    );
    const env: NodeJS.ProcessEnv = {};
    for (const [key, rawValue] of Object.entries(tool.env ?? {})) {
      const value = expand(rawValue, replacements);
      const parts = value.split(delimiter);
      env[key] = (
        await Promise.all(
          parts.map(async (part) => {
            if (!part && key !== 'TEXMFHOME') return '';
            const recursive = part.endsWith('//');
            const path = recursive ? part.slice(0, -2) : part;
            if (!path || /[$~{}!]/.test(path))
              throw new Error(`Unsupported search path in ${key}.`);
            const directory = await recipeDirectory(root, resolve(cwd, path));
            return directory + (recursive ? '//' : '');
          }),
        )
      ).join(delimiter);
      if (key === 'TEXMFHOME' && parts.length !== 1)
        throw new Error('TEXMFHOME requires one project directory.');
    }
    steps.push({ command, cwd, env, args: tool.args.map((arg) => expand(arg, replacements)) });
  }
  const jobNames = new Set<string>();
  for (const step of steps) {
    if (['bibtex', 'biber'].includes(step.command)) continue;
    const found = step.args.find((arg) => /^--?jobname=/.test(arg));
    jobNames.add(found ? found.slice(found.indexOf('=') + 1) : documentName);
  }
  if (jobNames.size > 1) throw new Error('Every compiler step must use the same job name.');
  const jobName = [...jobNames][0] ?? documentName;
  if (
    !jobName ||
    jobName.startsWith('-') ||
    /[\\/:<>"|?*]/.test(jobName) ||
    hasControlCharacters(jobName) ||
    /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(jobName) ||
    /[. ]$/.test(jobName) ||
    jobName === '.' ||
    jobName === '..'
  )
    throw new Error('The job name must be a simple file name.');
  return { root, document, output, auxiliary, jobName, pdf: join(output, `${jobName}.pdf`), steps };
}

/** Accept ordinary compiler options; executable commands and format/code injection are never options. */
export function recipeArguments(step: RecipeStep, plan: RecipePlan, miktex: boolean): string[] {
  const args: string[] = [];
  const bibliography = ['bibtex', 'biber'].includes(step.command);
  const latexmk = step.command === 'latexmk';
  let inputs = 0;
  let outputFlag = false;
  let auxFlag = false;
  const resolveArgumentDirectory = (value: string, expected: string) => {
    if (resolve(step.cwd, value) !== expected)
      throw new Error('Output/auxiliary flags must match the configured recipe directories.');
  };
  for (let index = 0; index < step.args.length; index++) {
    const arg = step.args[index]!;
    if (!arg || hasControlCharacters(arg)) throw new Error('Empty or invalid recipe argument.');
    if (!arg.startsWith('-')) {
      const expected = bibliography
        ? [plan.jobName, `${plan.jobName}.${step.command === 'bibtex' ? 'aux' : 'bcf'}`].map(
            (file) => resolve(plan.auxiliary, file),
          )
        : [plan.document, plan.document.replace(/\.tex$/i, '')];
      if (!expected.includes(resolve(step.cwd, arg)))
        throw new Error(
          'Recipe input must be the active document (or its generated bibliography).',
        );
      inputs++;
      args.push(arg);
      continue;
    }
    const match = /^--?([a-zA-Z0-9-]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unsupported recipe argument: ${arg}`);
    const key = match[1]!.toLowerCase();
    let value = match[2];
    if (['output-directory', 'outdir', 'aux-directory', 'auxdir'].includes(key)) {
      value ??= step.args[++index];
      if (!value) throw new Error(`Missing directory for ${arg}`);
      if (bibliography)
        throw new Error('Bibliography tools use the configured auxiliary working directory.');
      const auxiliary = key === 'aux-directory' || key === 'auxdir';
      resolveArgumentDirectory(value, auxiliary ? plan.auxiliary : plan.output);
      args.push(
        `-${latexmk ? (auxiliary ? 'auxdir' : 'outdir') : auxiliary ? 'aux-directory' : 'output-directory'}=${value}`,
      );
      if (auxiliary) auxFlag = true;
      else outputFlag = true;
      continue;
    }
    if (
      [
        'no-shell-escape',
        'disable-write18',
        'dont-parse-first-line',
        'no-parse-first-line',
        'disable-installer',
        'norc',
      ].includes(key) &&
      value === undefined
    )
      continue; // Supplied again below, after all user options.
    const common =
      !bibliography &&
      ((['halt-on-error', 'file-line-error', 'recorder'].includes(key) && value === undefined) ||
        (key === 'interaction' && ['nonstopmode', 'batchmode'].includes(value ?? '')) ||
        (key === 'synctex' && ['0', '1', '-1'].includes(value ?? '')) ||
        (key === 'jobname' && value === plan.jobName));
    const engine = !bibliography && !latexmk && key === 'draftmode' && value === undefined;
    const make =
      latexmk &&
      ['pdf', 'pdfxe', 'pdflua', 'xelatex', 'lualatex', 'g'].includes(key) &&
      value === undefined;
    const bib =
      bibliography &&
      ['quiet', 'terse', 'min-crossrefs'].includes(key) &&
      (key === 'min-crossrefs' ? /^\d{1,5}$/.test(value ?? '') : value === undefined);
    if (!common && !engine && !make && !bib)
      throw new Error(`Unsupported or unsafe ${step.command} option: ${arg}`);
    args.push(arg);
  }
  if (inputs !== 1) throw new Error('Every recipe step must have exactly one document input.');
  if (bibliography) {
    if (step.cwd !== plan.auxiliary)
      throw new Error('Bibliography tools must run in the configured auxiliary directory.');
    return [...(miktex ? ['-disable-installer'] : []), ...args];
  }
  if (plan.auxiliary !== plan.output && (latexmk || !miktex))
    throw new Error(
      'Separate auxiliary directories currently require a direct MiKTeX engine. Use the output directory for this tool.',
    );
  if (!outputFlag) args.unshift(`-${latexmk ? 'outdir' : 'output-directory'}=${plan.output}`);
  if (plan.auxiliary !== plan.output && !auxFlag) args.unshift(`-aux-directory=${plan.auxiliary}`);
  if (auxFlag && !miktex)
    throw new Error('This engine does not support an auxiliary-directory option.');
  const safeFlags = miktex
    ? ['-disable-installer', '-disable-write18', '-dont-parse-first-line']
    : ['-no-shell-escape', '-no-parse-first-line'];
  if (latexmk) {
    if (/["'`$&|<>^%!()\r\n]/.test([plan.root, ...args].join('')))
      throw new Error(
        'For paths with shell metacharacters use a direct TeX engine instead of latexmk.',
      );
    return [
      '-norc',
      '-g',
      '-view=none',
      ...safeFlags.map((flag) => `-latexoption=${flag}`),
      ...args,
    ];
  }
  return [...safeFlags, ...args];
}
