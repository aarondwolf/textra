import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from '../../icons';
import type { ProjectConfig } from '../../../../shared/api';
import {
  createDefaultRecipeSettings,
  RECIPE_COMMANDS,
  validateRecipeSettings,
  type RecipeSettings,
  type RecipeTool,
} from '../../../../shared/recipes';

interface CompileRecipeEditorProps {
  activePath: string | null;
  config: ProjectConfig | null;
  disabled: boolean;
  projectId: string;
  recipeName: string;
  onSaved: (config: ProjectConfig, recipeName: string) => void;
}

function configWithSettings(config: ProjectConfig | null): ProjectConfig {
  const base = config ?? { schemaVersion: 1, rootFile: null, engine: 'pdflatex' as const };
  return { ...base, ...validateRecipeSettings(base) };
}

function parseEnvironment(value: string): Record<string, string> | undefined {
  const entries = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('=');
      return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
    });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function formatEnvironment(environment: Record<string, string> | undefined): string {
  return Object.entries(environment ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function CompileRecipeEditor({
  activePath,
  config,
  disabled,
  projectId,
  recipeName,
  onSaved,
}: CompileRecipeEditorProps) {
  const [baseline, setBaseline] = useState<ProjectConfig>(() => configWithSettings(config));
  const [draft, setDraft] = useState<ProjectConfig>(() => configWithSettings(config));
  const [saveAsName, setSaveAsName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingRecipeIndex, setEditingRecipeIndex] = useState(() => {
    const recipes = validateRecipeSettings(config ?? {})['latex-workshop.latex.recipes'];
    return Math.max(
      0,
      recipes.findIndex((recipe) => recipe.name === recipeName),
    );
  });

  useEffect(() => {
    const next = configWithSettings(config);
    setBaseline(next);
    setDraft(next);
    setSaveAsName('');
    setError(null);
    setEditingRecipeIndex(
      Math.max(
        0,
        validateRecipeSettings(next)['latex-workshop.latex.recipes'].findIndex(
          (recipe) => recipe.name === recipeName,
        ),
      ),
    );
  }, [config, recipeName]);

  const settings = useMemo(
    () => ({ ...createDefaultRecipeSettings(), ...draft }) as RecipeSettings,
    [draft],
  );
  const recipes = settings['latex-workshop.latex.recipes'];
  const tools = settings['latex-workshop.latex.tools'];
  const recipeIndex = Math.min(editingRecipeIndex, recipes.length - 1);
  const recipe = recipes[recipeIndex]!;
  const usedTools = [...new Set(recipe.tools)]
    .map((name) => tools.find((tool) => tool.name === name))
    .filter((tool): tool is RecipeTool => tool !== undefined);

  function update(patch: Partial<ProjectConfig>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  }

  function updateRecipe(patch: Partial<typeof recipe>) {
    update({
      'latex-workshop.latex.recipes': recipes.map((entry, index) =>
        index === recipeIndex ? { ...entry, ...patch } : entry,
      ),
    });
  }

  function renameRecipe(name: string) {
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
  }

  function updateTool(name: string, patch: Partial<RecipeTool>) {
    update({
      'latex-workshop.latex.tools': tools.map((tool) =>
        tool.name === name ? { ...tool, ...patch } : tool,
      ),
    });
  }

  function renameTool(name: string, nextName: string) {
    update({
      'latex-workshop.latex.tools': tools.map((tool) =>
        tool.name === name ? { ...tool, name: nextName } : tool,
      ),
      'latex-workshop.latex.recipes': recipes.map((entry) => ({
        ...entry,
        tools: entry.tools.map((step) => (step === name ? nextName : step)),
      })),
    });
  }

  function moveStep(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= recipe.tools.length) return;
    const steps = [...recipe.tools];
    [steps[index], steps[nextIndex]] = [steps[nextIndex]!, steps[index]!];
    updateRecipe({ tools: steps });
  }

  function removeStep(index: number) {
    if (recipe.tools.length <= 1) return;
    updateRecipe({ tools: recipe.tools.filter((_, stepIndex) => stepIndex !== index) });
  }

  function addTool(command: string) {
    const preset = createDefaultRecipeSettings()['latex-workshop.latex.tools'].find(
      (tool) => tool.command === command,
    );
    if (!preset) return;
    let name = command;
    for (let suffix = 2; tools.some((tool) => tool.name === name); suffix++)
      name = `${command}-${suffix}`;
    update({
      'latex-workshop.latex.tools': [...tools, { ...structuredClone(preset), name }],
      'latex-workshop.latex.recipes': recipes.map((entry, index) =>
        index === recipeIndex ? { ...entry, tools: [...entry.tools, name] } : entry,
      ),
    });
  }

  async function save(asNew: boolean) {
    const selectedName = asNew ? saveAsName.trim() : recipe.name;
    if (!selectedName) {
      setError('Enter a name for the new recipe.');
      return;
    }
    if (asNew && recipes.some((entry) => entry.name === selectedName)) {
      setError(
        'A recipe already uses that name. Choose another name or overwrite the current recipe.',
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const candidate: ProjectConfig = asNew
        ? {
            ...draft,
            'latex-workshop.latex.recipes': [
              ...recipes,
              { ...recipe, name: selectedName, tools: [...recipe.tools] },
            ],
            recipes: activePath ? { ...draft.recipes, [activePath]: selectedName } : draft.recipes,
          }
        : {
            ...draft,
            recipes: activePath ? { ...draft.recipes, [activePath]: selectedName } : draft.recipes,
          };
      const normalized = { ...candidate, ...validateRecipeSettings(candidate) };
      const result = await window.textra.setProjectConfig({
        projectId,
        config: normalized,
        expectedConfig: baseline,
      });
      if (!result.ok) throw new Error(result.error);
      onSaved(result.value, selectedName);
      setBaseline(result.value);
      setDraft(result.value);
      setSaveAsName('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Recipe settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const locked = disabled || saving;
  return (
    <section className="compile-recipe-editor" aria-label="Current compile recipe settings">
      <div className="compile-editor-heading">
        <h3 className="writing-section-title">Current recipe</h3>
        <span className="recipe-hint">Edits are saved to this project.</span>
      </div>
      {error && (
        <p className="compile-recipe-error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={locked}>
        <label className="field-label">
          Recipe name
          <input
            aria-label="Current recipe name"
            value={recipe.name}
            onChange={(event) => renameRecipe(event.target.value)}
          />
        </label>
        <h4>Steps</h4>
        {recipe.tools.map((step, index) => (
          <div className="compile-recipe-step" key={`${step}-${index}`}>
            <span>{index + 1}</span>
            <select
              aria-label={`Current recipe step ${index + 1}`}
              value={step}
              onChange={(event) =>
                updateRecipe({
                  tools: recipe.tools.map((entry, position) =>
                    position === index ? event.target.value : entry,
                  ),
                })
              }
            >
              {tools.map((tool) => (
                <option key={tool.name} value={tool.name}>
                  {tool.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Move step ${index + 1} up`}
              onClick={() => moveStep(index, -1)}
              disabled={index === 0}
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              aria-label={`Move step ${index + 1} down`}
              onClick={() => moveStep(index, 1)}
              disabled={index === recipe.tools.length - 1}
            >
              <ArrowDown size={13} />
            </button>
            <button
              type="button"
              aria-label={`Remove step ${index + 1}`}
              onClick={() => removeStep(index)}
              disabled={recipe.tools.length === 1}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <label className="field-label">
          Add an existing tool
          <select
            aria-label="Add existing tool"
            value=""
            onChange={(event) =>
              event.target.value && updateRecipe({ tools: [...recipe.tools, event.target.value] })
            }
          >
            <option value="">Choose a tool…</option>
            {tools.map((tool) => (
              <option key={tool.name} value={tool.name}>
                {tool.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Create and add a tool
          <select
            aria-label="Create tool for current recipe"
            value=""
            onChange={(event) => event.target.value && addTool(event.target.value)}
          >
            <option value="">Choose a program…</option>
            {RECIPE_COMMANDS.map((command) => (
              <option key={command} value={command}>
                {command}
              </option>
            ))}
          </select>
        </label>
        <h4>Tools used by this recipe</h4>
        <p className="recipe-hint">
          Tools may be shared by other recipes. Changing one updates every recipe that uses it.
        </p>
        {usedTools.map((tool) => (
          <details className="compile-tool-card" key={tool.name}>
            <summary>
              {tool.name} <code>{tool.command}</code>
            </summary>
            <label className="field-label">
              Tool name
              <input
                aria-label={`Tool name ${tool.name}`}
                value={tool.name}
                onChange={(event) => renameTool(tool.name, event.target.value)}
              />
            </label>
            <label className="field-label">
              Program
              <select
                aria-label={`Program ${tool.name}`}
                value={tool.command.replace(/\.exe$/i, '').toLowerCase()}
                onChange={(event) => {
                  const preset = createDefaultRecipeSettings()['latex-workshop.latex.tools'].find(
                    (entry) => entry.command === event.target.value,
                  )!;
                  updateTool(tool.name, {
                    command: preset.command,
                    args: structuredClone(preset.args),
                    cwd: preset.cwd,
                  });
                }}
              >
                {RECIPE_COMMANDS.map((command) => (
                  <option key={command} value={command}>
                    {command}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Arguments <small>One argument per line.</small>
              <textarea
                aria-label={`Arguments ${tool.name}`}
                rows={5}
                spellCheck={false}
                value={tool.args.join('\n')}
                onChange={(event) =>
                  updateTool(tool.name, { args: event.target.value.split(/\r?\n/).filter(Boolean) })
                }
              />
            </label>
            <label className="field-label">
              Working directory
              <input
                aria-label={`Working directory ${tool.name}`}
                value={tool.cwd ?? ''}
                onChange={(event) =>
                  updateTool(tool.name, { cwd: event.target.value || undefined })
                }
              />
            </label>
            <label className="field-label">
              Environment <small>One allowed KEY=value entry per line.</small>
              <textarea
                aria-label={`Environment ${tool.name}`}
                rows={3}
                spellCheck={false}
                value={formatEnvironment(tool.env)}
                onChange={(event) =>
                  updateTool(tool.name, { env: parseEnvironment(event.target.value) })
                }
              />
            </label>
          </details>
        ))}
        <h4>Output and default</h4>
        <label className="field-label">
          Output directory
          <input
            aria-label="Current recipe output directory"
            value={settings['latex-workshop.latex.outDir']}
            onChange={(event) => update({ 'latex-workshop.latex.outDir': event.target.value })}
          />
        </label>
        <label className="field-label">
          Auxiliary directory
          <input
            aria-label="Current recipe auxiliary directory"
            value={settings['latex-workshop.latex.auxDir']}
            onChange={(event) => update({ 'latex-workshop.latex.auxDir': event.target.value })}
          />
        </label>
        <label className="field-label">
          Project default recipe
          <select
            aria-label="Project default recipe"
            value={settings['latex-workshop.latex.recipe.default']}
            onChange={(event) =>
              update({ 'latex-workshop.latex.recipe.default': event.target.value })
            }
          >
            <option value="lastUsed">Last used / app default</option>
            <option value="first">First recipe</option>
            {recipes.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <div className="compile-recipe-actions">
        <button
          type="button"
          className="text-button"
          onClick={() => void save(false)}
          disabled={locked}
        >
          <Save size={13} /> Overwrite recipe
        </button>
        <input
          aria-label="New recipe name"
          placeholder="New recipe name"
          value={saveAsName}
          disabled={locked}
          onChange={(event) => setSaveAsName(event.target.value)}
        />
        <button
          type="button"
          className="text-button"
          onClick={() => void save(true)}
          disabled={locked}
        >
          <Plus size={13} /> Save as new
        </button>
      </div>
    </section>
  );
}
