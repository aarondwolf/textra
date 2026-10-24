import { z } from 'zod';

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

export const recipeNameSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((val) => val.trim().length > 0 && ![...val].some((c) => c.charCodeAt(0) < 32));

export const recipeTextSchema = z
  .string()
  .max(8192)
  .refine((val) => ![...val].some((c) => [0, 10, 13].includes(c.charCodeAt(0))));

export const recipeToolEnvSchema = z.record(z.string(), recipeTextSchema).refine(
  (env) => {
    const allowed = ['TEXINPUTS', 'BIBINPUTS', 'BSTINPUTS', 'TEXMFHOME'];
    const keys = Object.keys(env);
    return keys.length <= 20 && keys.every((k) => allowed.includes(k));
  },
  { message: 'Tool env supports only TEXINPUTS, BIBINPUTS, BSTINPUTS and TEXMFHOME.' },
);

export const recipeToolSchema = z
  .object({
    name: recipeNameSchema,
    command: recipeTextSchema.refine((cmd) =>
      RECIPE_COMMANDS.includes(
        cmd.replace(/\.exe$/i, '').toLowerCase() as (typeof RECIPE_COMMANDS)[number],
      ),
    ),
    args: z.array(recipeTextSchema).max(128),
    env: recipeToolEnvSchema.optional(),
    cwd: recipeTextSchema.optional(),
  })
  .strict();

export const buildRecipeSchema = z
  .object({
    name: recipeNameSchema,
    tools: z.array(recipeNameSchema).min(1).max(32),
  })
  .strict();

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
      tool &&
      typeof tool === 'object' &&
      tool.env !== undefined &&
      (!tool.env ||
        typeof tool.env !== 'object' ||
        Array.isArray(tool.env) ||
        Object.keys(tool.env).length > 20 ||
        Object.entries(tool.env).some(
          ([key, val]) =>
            !['TEXINPUTS', 'BIBINPUTS', 'BSTINPUTS', 'TEXMFHOME'].includes(key) ||
            !recipeTextSchema.safeParse(val).success,
        ))
    ) {
      throw new Error('Tool env supports only TEXINPUTS, BIBINPUTS, BSTINPUTS and TEXMFHOME.');
    }

    const toolResult = recipeToolSchema.safeParse(tool);
    if (!toolResult.success) {
      throw new Error(
        'Tools require a name, an installed TeX command and an argument array. Supported commands: ' +
          RECIPE_COMMANDS.join(', ') +
          '.',
      );
    }
  }

  if (
    new Set(tools.map((tool) => tool.name)).size !== tools.length ||
    new Set(recipes.map((recipe) => recipe?.name)).size !== recipes.length
  )
    throw new Error('Recipe and tool names must be unique.');

  for (const recipe of recipes) {
    const recipeResult = buildRecipeSchema.safeParse(recipe);
    if (!recipeResult.success || recipe.tools.some((step) => !tools.some((t) => t.name === step))) {
      throw new Error(
        'Each recipe needs a unique name and 1–32 steps referencing existing tool names.',
      );
    }
  }

  for (const key of ['latex-workshop.latex.outDir', 'latex-workshop.latex.auxDir'] as const) {
    const val = settings[key];
    const textResult = recipeTextSchema.safeParse(val);
    if (!textResult.success || !val.trim())
      throw new Error('Output and auxiliary directories are required.');
  }

  const selected = settings['latex-workshop.latex.recipe.default'];
  const nameResult = recipeNameSchema.safeParse(selected);
  if (
    !nameResult.success ||
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
