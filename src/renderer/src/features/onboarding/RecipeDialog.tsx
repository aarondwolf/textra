import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { parse, type ParseError } from 'jsonc-parser';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import type { ProjectConfig } from '../../../../shared/api';
import {
  createDefaultRecipeSettings,
  validateRecipeSettings,
  RECIPE_COMMANDS,
  type RecipeSettings,
  type RecipeTool,
} from '../../../../shared/recipes';
import { useWorkspace } from '../../state/workspace';
import './recipes.css';

function initial(): ProjectConfig {
  return { schemaVersion: 1, rootFile: null, engine: 'pdflatex', ...createDefaultRecipeSettings() };
}
function readJSON(text: string): ProjectConfig {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(
      'Enter a valid JSON settings object. Comments and trailing commas are supported.',
    );
  return { ...initial(), ...value };
}

export default function RecipeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const project = useWorkspace((state) => state.project);
  const [baseline, setBaseline] = useState<ProjectConfig | null>(null);
  const [draft, setDraft] = useState<ProjectConfig>(initial);
  const [recipeIndex, setRecipeIndex] = useState(0);
  const [toolIndex, setToolIndex] = useState(0);
  const [mode, setMode] = useState<'builder' | 'json'>('builder');
  const [json, setJSON] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !project) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    setBaseline(null);
    setMode('builder');
    void window.textra
      .getProjectConfig(project.id)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) throw new Error(result.error);
        const config = { ...result.value, ...validateRecipeSettings(result.value) };
        setDraft(config);
        setBaseline(config);
        setRecipeIndex(0);
        setToolIndex(0);
      })
      .catch((failure: unknown) => {
        if (!cancelled)
          setError(failure instanceof Error ? failure.message : 'Settings could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, project]);
  const settings = { ...createDefaultRecipeSettings(), ...draft } as RecipeSettings;
  const recipes = settings['latex-workshop.latex.recipes'];
  const tools = settings['latex-workshop.latex.tools'];
  const recipe = recipes[recipeIndex] ?? recipes[0];
  const tool = tools[toolIndex] ?? tools[0];
  function update(patch: Partial<ProjectConfig>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setError(null);
  }
  function updateTool(patch: Partial<RecipeTool>) {
    update({
      'latex-workshop.latex.tools': tools.map((entry, index) =>
        index === toolIndex ? { ...entry, ...patch } : entry,
      ),
    });
  }
  function switchMode(next: 'builder' | 'json') {
    try {
      if (next === 'json') setJSON(JSON.stringify(draft, null, 2));
      else {
        const parsed = readJSON(json);
        setDraft({ ...parsed, ...validateRecipeSettings(parsed) });
        setRecipeIndex(0);
        setToolIndex(0);
      }
      setMode(next);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Invalid settings.');
    }
  }
  async function save() {
    if (!project || !baseline) return;
    setBusy(true);
    setError(null);
    try {
      const candidate = mode === 'json' ? readJSON(json) : draft;
      const config = { ...candidate, ...validateRecipeSettings(candidate) };
      const result = await window.textra.setProjectConfig({
        projectId: project.id,
        config,
        expectedConfig: baseline,
      });
      if (!result.ok) throw new Error(result.error);
      if (useWorkspace.getState().project?.id === project.id)
        useWorkspace.setState({ projectConfig: result.value, recipes: result.value.recipes ?? {} });
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  const texTools = tools.filter(
    (entry) =>
      recipe.tools.includes(entry.name) &&
      /^(?:pdf|xe|lua)latex(?:\.exe)?$|^latexmk(?:\.exe)?$/i.test(entry.command),
  );
  const synctex =
    texTools.length > 0 &&
    texTools.every((entry) => entry.args.some((arg) => /^--?synctex=-?1$/.test(arg)));
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="recipe-dialog">
          <div className="setup-heading">
            <Dialog.Title>Build recipes</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close build recipes" disabled={busy}>
              <X size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            Project settings · <code>.textra/settings.json</code>
          </Dialog.Description>
          <div className="recipe-mode" role="group" aria-label="Recipe editor mode">
            <button
              aria-pressed={mode === 'builder'}
              onClick={() => switchMode('builder')}
              disabled={mode === 'builder' || busy}
            >
              Builder
            </button>
            <button
              aria-pressed={mode === 'json'}
              onClick={() => switchMode('json')}
              disabled={mode === 'json' || busy}
            >
              settings.json
            </button>
          </div>
          {!project && <p>Open a project folder to edit its recipes.</p>}
          {error && (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          )}
          <fieldset className="recipe-scroll" disabled={busy || !baseline}>
            {mode === 'json' ? (
              <>
                <p className="recipe-hint">
                  Paste LaTeX Workshop recipe/tool definitions here. The same named recipes, ordered
                  tools, arguments, and path placeholders are used.
                </p>
                <textarea
                  className="recipe-json"
                  aria-label="Project settings JSON"
                  spellCheck={false}
                  value={json}
                  onChange={(event) => setJSON(event.target.value)}
                />
              </>
            ) : (
              <>
                <div className="recipe-fields">
                  <label className="field-label">
                    Recipe
                    <select
                      aria-label="Recipe to edit"
                      value={recipeIndex}
                      onChange={(event) => setRecipeIndex(Number(event.target.value))}
                    >
                      {recipes.map((entry, index) => (
                        <option key={index} value={index}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() => {
                      let name = 'New recipe';
                      for (let suffix = 2; recipes.some((entry) => entry.name === name); suffix++)
                        name = `New recipe ${suffix}`;
                      update({
                        'latex-workshop.latex.recipes': [
                          ...recipes,
                          { name, tools: [tools[0].name] },
                        ],
                      });
                      setRecipeIndex(recipes.length);
                    }}
                  >
                    <Plus size={14} />
                    New recipe
                  </button>
                </div>
                <label className="field-label">
                  Recipe name
                  <input
                    aria-label="Recipe name"
                    value={recipe.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      update({
                        'latex-workshop.latex.recipes': recipes.map((entry, index) =>
                          index === recipeIndex ? { ...entry, name } : entry,
                        ),
                        'latex-workshop.latex.recipe.default':
                          settings['latex-workshop.latex.recipe.default'] === recipe.name
                            ? name
                            : settings['latex-workshop.latex.recipe.default'],
                        recipes: Object.fromEntries(
                          Object.entries(draft.recipes ?? {}).map(([path, selected]) => [
                            path,
                            selected === recipe.name ? name : selected,
                          ]),
                        ),
                      });
                    }}
                  />
                </label>
                <div className="recipe-section-heading">
                  <h3>Ordered steps</h3>
                  <button
                    disabled={recipes.length <= 1}
                    onClick={() => {
                      update({
                        'latex-workshop.latex.recipes': recipes.filter(
                          (_, index) => index !== recipeIndex,
                        ),
                        recipes: Object.fromEntries(
                          Object.entries(draft.recipes ?? {}).filter(
                            ([, name]) => name !== recipe.name,
                          ),
                        ),
                        'latex-workshop.latex.recipe.default': 'lastUsed',
                      });
                      setRecipeIndex(0);
                    }}
                  >
                    Delete recipe
                  </button>
                </div>
                {recipe.tools.map((step, index) => (
                  <div className="recipe-step" key={index}>
                    <span>{index + 1}</span>
                    <select
                      aria-label={`Step ${index + 1} tool`}
                      value={step}
                      onChange={(event) =>
                        update({
                          'latex-workshop.latex.recipes': recipes.map((entry, at) =>
                            at === recipeIndex
                              ? {
                                  ...entry,
                                  tools: entry.tools.map((name, position) =>
                                    position === index ? event.target.value : name,
                                  ),
                                }
                              : entry,
                          ),
                        })
                      }
                    >
                      {tools.map((entry) => (
                        <option key={entry.name} value={entry.name}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                    {([-1, 1] as const).map((direction) => (
                      <button
                        key={direction}
                        aria-label={`Move step ${index + 1} ${direction === -1 ? 'up' : 'down'}`}
                        disabled={index + direction < 0 || index + direction >= recipe.tools.length}
                        onClick={() => {
                          const steps = [...recipe.tools];
                          [steps[index], steps[index + direction]] = [
                            steps[index + direction],
                            steps[index],
                          ];
                          update({
                            'latex-workshop.latex.recipes': recipes.map((entry, at) =>
                              at === recipeIndex ? { ...entry, tools: steps } : entry,
                            ),
                          });
                        }}
                      >
                        {direction === -1 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                      </button>
                    ))}
                    <button
                      aria-label={`Remove step ${index + 1}`}
                      disabled={recipe.tools.length <= 1}
                      onClick={() =>
                        update({
                          'latex-workshop.latex.recipes': recipes.map((entry, at) =>
                            at === recipeIndex
                              ? {
                                  ...entry,
                                  tools: entry.tools.filter((_, position) => position !== index),
                                }
                              : entry,
                          ),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    update({
                      'latex-workshop.latex.recipes': recipes.map((entry, at) =>
                        at === recipeIndex
                          ? { ...entry, tools: [...entry.tools, tools[0].name] }
                          : entry,
                      ),
                    })
                  }
                >
                  Add step
                </button>
                <h3>Paths and navigation</h3>
                <label className="field-label">
                  Output directory
                  <input
                    aria-label="Output directory"
                    value={settings['latex-workshop.latex.outDir']}
                    onChange={(event) =>
                      update({ 'latex-workshop.latex.outDir': event.target.value })
                    }
                  />
                </label>
                <label className="field-label">
                  Auxiliary directory
                  <input
                    aria-label="Auxiliary directory"
                    value={settings['latex-workshop.latex.auxDir']}
                    onChange={(event) =>
                      update({ 'latex-workshop.latex.auxDir': event.target.value })
                    }
                  />
                </label>
                <p className="recipe-hint">
                  Paths stay inside the project. Use %OUTDIR% for auxiliary files beside the PDF, or
                  %DIR% for output beside the source. Separate auxiliary directories depend on the
                  installed compiler.
                </p>
                <label className="recipe-checkbox">
                  <input
                    type="checkbox"
                    aria-label="Enable SyncTeX"
                    checked={synctex}
                    disabled={!texTools.length}
                    onChange={(event) =>
                      update({
                        'latex-workshop.latex.tools': tools.map((entry) =>
                          texTools.includes(entry)
                            ? {
                                ...entry,
                                args: [
                                  `-synctex=${event.target.checked ? 1 : 0}`,
                                  ...entry.args.filter((arg) => !/^--?synctex(?:=|$)/.test(arg)),
                                ],
                              }
                            : entry,
                        ),
                      })
                    }
                  />
                  Enable SyncTeX for this recipe's TeX tools
                </label>
                <label className="field-label">
                  Default for new documents
                  <select
                    aria-label="Project default recipe"
                    value={settings['latex-workshop.latex.recipe.default']}
                    onChange={(event) =>
                      update({ 'latex-workshop.latex.recipe.default': event.target.value })
                    }
                  >
                    <option value="lastUsed">Last used / app default</option>
                    <option value="first">First recipe</option>
                    {recipes.map((entry, index) => (
                      <option key={index} value={entry.name}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
                <h3>Tool definitions</h3>
                <p className="recipe-hint">
                  Tools are shared by recipes. Arguments below are one argument per line; quotes are
                  not needed around paths. Environment overrides can be edited in settings.json.
                </p>
                <div className="recipe-fields">
                  <label className="field-label">
                    Tool
                    <select
                      aria-label="Tool to edit"
                      value={toolIndex}
                      onChange={(event) => setToolIndex(Number(event.target.value))}
                    >
                      {tools.map((entry, index) => (
                        <option key={index} value={index}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() => {
                      let name = 'tool';
                      for (let suffix = 2; tools.some((entry) => entry.name === name); suffix++)
                        name = `tool-${suffix}`;
                      update({
                        'latex-workshop.latex.tools': [
                          ...tools,
                          {
                            ...createDefaultRecipeSettings()['latex-workshop.latex.tools'][0],
                            name,
                          },
                        ],
                      });
                      setToolIndex(tools.length);
                    }}
                  >
                    New tool
                  </button>
                </div>
                <label className="field-label">
                  Tool name
                  <input
                    aria-label="Tool name"
                    value={tool.name}
                    onChange={(event) => {
                      const name = event.target.value;
                      update({
                        'latex-workshop.latex.tools': tools.map((entry, at) =>
                          at === toolIndex ? { ...entry, name } : entry,
                        ),
                        'latex-workshop.latex.recipes': recipes.map((entry) => ({
                          ...entry,
                          tools: entry.tools.map((step) => (step === tool.name ? name : step)),
                        })),
                      });
                    }}
                  />
                </label>
                <label className="field-label">
                  Command
                  <select
                    aria-label="Tool command"
                    value={tool.command.replace(/\.exe$/i, '').toLowerCase()}
                    onChange={(event) => {
                      const preset = createDefaultRecipeSettings()[
                        'latex-workshop.latex.tools'
                      ].find((entry) => entry.command === event.target.value)!;
                      updateTool({ command: preset.command, args: preset.args, cwd: preset.cwd });
                    }}
                  >
                    {RECIPE_COMMANDS.map((command) => (
                      <option key={command}>{command}</option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Working directory
                  <input
                    aria-label="Tool working directory"
                    value={tool.cwd ?? '%DIR%'}
                    onChange={(event) => updateTool({ cwd: event.target.value })}
                  />
                </label>
                <label className="field-label">
                  Arguments
                  <textarea
                    aria-label="Tool arguments"
                    spellCheck={false}
                    rows={7}
                    value={tool.args.join('\n')}
                    onChange={(event) =>
                      updateTool({
                        args: event.target.value.split('\n').filter((arg) => arg.length > 0),
                      })
                    }
                  />
                </label>
              </>
            )}
          </fieldset>
          <div className="dialog-actions">
            <button onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </button>
            <button
              className="primary-button"
              onClick={() => void save()}
              disabled={busy || !baseline}
            >
              {busy ? (baseline ? 'Saving…' : 'Loading…') : 'Save project settings'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
