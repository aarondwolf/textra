/** Friendly descriptions and helpers used by the guided build recipe editor. */
import type { RecipeTool } from './recipes';

export type ToolKind = 'engine' | 'latexmk' | 'bibliography';

export function toolKind(command: string): ToolKind {
  const name = command.replace(/\.exe$/i, '').toLowerCase();
  if (name === 'latexmk') return 'latexmk';
  if (name === 'bibtex' || name === 'biber') return 'bibliography';
  return 'engine';
}

export interface ArgHelp {
  arg: string;
  label: string;
  description: string;
  /** Options in the same group replace each other. */
  group?: string;
}

const COMMON: ArgHelp[] = [
  {
    arg: '-synctex=1',
    label: 'SyncTeX',
    description:
      'Records where each piece of text came from, so you can jump between the source and the PDF.',
    group: 'synctex',
  },
  {
    arg: '-interaction=nonstopmode',
    label: 'Keep going on errors',
    description:
      'Adds -interaction=nonstopmode. TeX does not stop and wait for input when it finds an error. It keeps going and reports the problem in the log.',
  },
  {
    arg: '-file-line-error',
    label: 'File and line in errors',
    description:
      'Reports each error with its file name and line number, so the Problems tab can jump straight to it.',
  },
  {
    arg: '-halt-on-error',
    label: 'Stop at first error',
    description: 'Ends the build at the first error instead of trying to continue past it.',
  },
  {
    arg: '-recorder',
    label: 'Record files used',
    description: 'Writes a .fls list of every file the build reads and writes.',
  },
];

export const ARG_HELP: Record<ToolKind, ArgHelp[]> = {
  engine: [
    ...COMMON,
    {
      arg: '-draftmode',
      label: 'Draft mode',
      description:
        'Skips writing the PDF. Useful for early passes of a multi-step recipe, but the last pass must not use it.',
    },
  ],
  latexmk: [
    {
      arg: '-pdf',
      label: 'pdfLaTeX',
      description: 'latexmk builds with pdfLaTeX.',
      group: 'mode',
    },
    {
      arg: '-pdfxe',
      label: 'XeLaTeX',
      description: 'latexmk builds with XeLaTeX.',
      group: 'mode',
    },
    {
      arg: '-pdflua',
      label: 'LuaLaTeX',
      description: 'latexmk builds with LuaLaTeX.',
      group: 'mode',
    },
    ...COMMON,
  ],
  bibliography: [
    {
      arg: '-quiet',
      label: 'Quiet',
      description: 'Prints less while the bibliography is processed.',
    },
  ],
};

export const PLACEHOLDER_HELP: Array<{ tag: string; description: string }> = [
  { tag: '%DIR%', description: 'The folder that contains the .tex file being compiled.' },
  {
    tag: '%OUTDIR%',
    description: 'The output folder chosen in Output location. The PDF is written here.',
  },
  {
    tag: '%AUXDIR%',
    description: 'Where auxiliary files (.aux, .log, .toc and so on) are kept.',
  },
  {
    tag: '%RELATIVE_DOC%',
    description:
      "The document's path inside the project without its extension (for example chapters/intro). Using it gives every document its own subfolder, so same-named files in different folders never overwrite each other.",
  },
  { tag: '%RELATIVE_DIR%', description: "The document's folder, relative to the project folder." },
  { tag: '%WORKSPACE_FOLDER%', description: 'The project folder you opened.' },
  { tag: '%DOC%', description: 'Full path of the document, without the .tex extension.' },
  { tag: '%DOC_EXT%', description: 'Full path of the document, including .tex.' },
  { tag: '%DOCFILE%', description: 'The document file name without its extension.' },
  { tag: '%DOCFILE_EXT%', description: 'The document file name including .tex.' },
];

const MANAGED = /^--?(?:output-directory|outdir|aux-directory|auxdir)(?:=|$)/;

export type ArgRole = 'managed' | 'input' | 'known' | 'custom';

export function classifyArg(arg: string, kind: ToolKind): ArgRole {
  if (!arg.startsWith('-')) return 'input';
  if (MANAGED.test(arg)) return 'managed';
  return ARG_HELP[kind].some((entry) => entry.arg === arg) ? 'known' : 'custom';
}

/** Inserts an option before the document input so the input stays last. */
export function addArg(args: string[], arg: string): string[] {
  const input = args.findIndex((entry) => !entry.startsWith('-'));
  return input === -1 ? [...args, arg] : [...args.slice(0, input), arg, ...args.slice(input)];
}

export function isArgOn(args: string[], help: ArgHelp): boolean {
  if (help.group === 'synctex') return args.includes(help.arg) || args.includes('--synctex=1');
  return args.includes(help.arg);
}

export function toggleArg(args: string[], kind: ToolKind, help: ArgHelp): string[] {
  if (isArgOn(args, help)) {
    return args.filter((entry) =>
      help.group === 'synctex' ? !/^--?synctex(?:=|$)/.test(entry) : entry !== help.arg,
    );
  }
  let next = args;
  if (help.group === 'synctex') next = next.filter((entry) => !/^--?synctex(?:=|$)/.test(entry));
  if (help.group && help.group !== 'synctex') {
    const siblings = ARG_HELP[kind].filter((entry) => entry.group === help.group);
    next = next.filter((entry) => !siblings.some((sibling) => sibling.arg === entry));
  }
  return addArg(next, help.arg);
}

export type OutputMode = 'build' | 'beside' | 'custom';
export interface OutputLocation {
  mode: OutputMode;
  folder: string;
  perDocument: boolean;
}

export const DEFAULT_BUILD_FOLDER = 'build/textra';
const PER_DOCUMENT = '/%RELATIVE_DOC%';

function splitFolder(value: string): { folder: string; perDocument: boolean } | null {
  if (value.includes('%') && !value.endsWith(PER_DOCUMENT)) return null;
  const perDocument = value.endsWith(PER_DOCUMENT);
  const folder = perDocument ? value.slice(0, -PER_DOCUMENT.length) : value;
  return folder && !folder.includes('%') ? { folder, perDocument } : null;
}

/** Recognises the two guided layouts; anything else is "custom". */
export function readOutputLocation(outDir: string, auxDir: string): OutputLocation {
  if (auxDir === '%OUTDIR%') {
    const parts = splitFolder(outDir);
    if (parts) return { mode: 'build', ...parts };
  }
  if (outDir === '%DIR%') {
    const parts = splitFolder(auxDir);
    if (parts) return { mode: 'beside', ...parts };
  }
  return { mode: 'custom', folder: DEFAULT_BUILD_FOLDER, perDocument: true };
}

export function writeOutputLocation(location: OutputLocation): { outDir: string; auxDir: string } {
  const folder = location.folder.trim().replace(/[\\/]+$/, '') || DEFAULT_BUILD_FOLDER;
  const target = folder + (location.perDocument ? PER_DOCUMENT : '');
  return location.mode === 'beside'
    ? { outDir: '%DIR%', auxDir: target }
    : { outDir: target, auxDir: '%OUTDIR%' };
}

const DRAFT: ArgHelp = ARG_HELP.engine.find((entry) => entry.arg === '-draftmode')!;

/**
 * Makes every compiler pass except the last one use a "-draft" copy of its tool that adds
 * -draftmode (no PDF is written, but .aux and friends are, so references still resolve).
 * Returns new tool and step lists; existing draft copies are reused.
 */
export function draftEarlyPasses(
  steps: string[],
  tools: RecipeTool[],
): { steps: string[]; tools: RecipeTool[] } {
  const next = [...tools];
  const compiler = (name: string) => {
    const tool = next.find((entry) => entry.name === name);
    return tool !== undefined && toolKind(tool.command) === 'engine';
  };
  const last = steps.map(compiler).lastIndexOf(true);
  const result = steps.map((name, index) => {
    if (index >= last || !compiler(name)) return name;
    const base = next.find((entry) => entry.name === name)!;
    if (isArgOn(base.args, DRAFT)) return name;
    const draftName = `${name}-draft`;
    if (!next.some((entry) => entry.name === draftName))
      next.push({
        ...structuredClone(base),
        name: draftName,
        args: toggleArg(base.args, 'engine', DRAFT),
      });
    return draftName;
  });
  return { steps: result, tools: next };
}
