export const RECIPE_COMMANDS = [
  'pdflatex',
  'xelatex',
  'lualatex',
  'latexmk',
  'bibtex',
  'biber',
] as const;
export interface RecipeTool {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}
export interface BuildRecipe {
  name: string;
  tools: string[];
}
export interface RecipeSettings {
  'latex-workshop.latex.recipes': BuildRecipe[];
  'latex-workshop.latex.tools': RecipeTool[];
  'latex-workshop.latex.outDir': string;
  'latex-workshop.latex.auxDir': string;
  'latex-workshop.latex.recipe.default': string;
}
export function createDefaultRecipeSettings(): RecipeSettings {
  return {
    'latex-workshop.latex.recipes': [
      { name: 'pdflatex', tools: ['pdflatex', 'pdflatex'] },
      { name: 'xelatex', tools: ['xelatex', 'xelatex'] },
      { name: 'lualatex', tools: ['lualatex', 'lualatex'] },
      { name: 'latexmk', tools: ['latexmk'] },
      { name: 'bibtex-pipeline', tools: ['pdflatex', 'bibtex', 'pdflatex', 'pdflatex'] },
    ],
    'latex-workshop.latex.tools': [
      ...(['pdflatex', 'xelatex', 'lualatex'] as const).map((command) => ({
        name: command,
        command,
        args: [
          '-synctex=1',
          '-interaction=nonstopmode',
          '-file-line-error',
          '-halt-on-error',
          '-output-directory=%OUTDIR%',
          '%DOC_EXT%',
        ],
        cwd: '%DIR%',
      })),
      {
        name: 'latexmk',
        command: 'latexmk',
        args: [
          '-pdf',
          '-synctex=1',
          '-interaction=nonstopmode',
          '-file-line-error',
          '-outdir=%OUTDIR%',
          '%DOC_EXT%',
        ],
        cwd: '%DIR%',
      },
      { name: 'bibtex', command: 'bibtex', args: ['%DOCFILE%'], cwd: '%AUXDIR%' },
      { name: 'biber', command: 'biber', args: ['%DOCFILE%'], cwd: '%AUXDIR%' },
    ],
    'latex-workshop.latex.outDir': 'build/textra/%RELATIVE_DOC%',
    'latex-workshop.latex.auxDir': '%OUTDIR%',
    'latex-workshop.latex.recipe.default': 'lastUsed',
  };
}

/** Shared shape checks; command flags and filesystem paths are enforced again in main. */
export function validateRecipeSettings(value: unknown): RecipeSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Recipe settings must be an object.');
  const settings = { ...createDefaultRecipeSettings(), ...value } as RecipeSettings;
  const recipes = settings['latex-workshop.latex.recipes'];
  const tools = settings['latex-workshop.latex.tools'];
  const name = (value: unknown): value is string =>
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 128 &&
    ![...value].some((character) => character.charCodeAt(0) < 32);
  const text = (value: unknown): value is string =>
    typeof value === 'string' &&
    value.length <= 8192 &&
    ![...value].some((character) => [0, 10, 13].includes(character.charCodeAt(0)));
  if (
    !Array.isArray(recipes) ||
    !recipes.length ||
    recipes.length > 100 ||
    !Array.isArray(tools) ||
    !tools.length ||
    tools.length > 200
  )
    throw new Error('Provide 1–100 recipes and 1–200 tools.');
  for (const tool of tools) {
    if (
      !tool ||
      !name(tool.name) ||
      !text(tool.command) ||
      !RECIPE_COMMANDS.includes(
        tool.command.replace(/\.exe$/i, '').toLowerCase() as (typeof RECIPE_COMMANDS)[number],
      ) ||
      !Array.isArray(tool.args) ||
      tool.args.length > 128 ||
      !tool.args.every(text) ||
      (tool.cwd !== undefined && !text(tool.cwd)) ||
      Object.keys(tool).some((key) => !['name', 'command', 'args', 'env', 'cwd'].includes(key))
    )
      throw new Error(
        'Tools require a name, an installed TeX command and an argument array. Supported commands: ' +
          RECIPE_COMMANDS.join(', ') +
          '.',
      );
    if (
      tool.env !== undefined &&
      (!tool.env ||
        typeof tool.env !== 'object' ||
        Array.isArray(tool.env) ||
        Object.keys(tool.env).length > 20 ||
        Object.entries(tool.env).some(
          ([key, value]) =>
            !['TEXINPUTS', 'BIBINPUTS', 'BSTINPUTS', 'TEXMFHOME'].includes(key) || !text(value),
        ))
    )
      throw new Error('Tool env supports only TEXINPUTS, BIBINPUTS, BSTINPUTS and TEXMFHOME.');
  }
  if (
    new Set(tools.map((tool) => tool.name)).size !== tools.length ||
    new Set(recipes.map((recipe) => recipe?.name)).size !== recipes.length
  )
    throw new Error('Recipe and tool names must be unique.');
  for (const recipe of recipes) {
    if (
      !recipe ||
      !name(recipe.name) ||
      !Array.isArray(recipe.tools) ||
      !recipe.tools.length ||
      recipe.tools.length > 32 ||
      recipe.tools.some((step) => !name(step) || !tools.some((tool) => tool.name === step)) ||
      Object.keys(recipe).some((key) => !['name', 'tools'].includes(key))
    )
      throw new Error(
        'Each recipe needs a unique name and 1–32 steps referencing existing tool names.',
      );
  }
  for (const key of ['latex-workshop.latex.outDir', 'latex-workshop.latex.auxDir'] as const)
    if (!text(settings[key]) || !settings[key].trim())
      throw new Error('Output and auxiliary directories are required.');
  const selected = settings['latex-workshop.latex.recipe.default'];
  if (
    !name(selected) ||
    (!['first', 'lastUsed'].includes(selected) &&
      !recipes.some((recipe) => recipe.name === selected))
  )
    throw new Error('Default recipe must be first, lastUsed, or an existing recipe name.');
  return structuredClone({
    'latex-workshop.latex.recipes': recipes,
    'latex-workshop.latex.tools': tools,
    'latex-workshop.latex.outDir': settings['latex-workshop.latex.outDir'],
    'latex-workshop.latex.auxDir': settings['latex-workshop.latex.auxDir'],
    'latex-workshop.latex.recipe.default': selected,
  });
}
