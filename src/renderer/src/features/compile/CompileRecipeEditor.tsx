import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, Pencil, Plus, Save, Trash2, X } from '../../icons';
import type { ProjectConfig } from '../../../../shared/api';
import { BUILD_RECIPES } from '../../../../shared/api';
import {
  createDefaultRecipeSettings,
  validateRecipeSettings,
  type RecipeSettings,
  type RecipeTool,
} from '../../../../shared/recipes';
import { ToolEditorDialog } from './ToolEditorDialog';

interface CompileRecipeEditorProps {
  activePath: string | null;
  config: ProjectConfig | null;
  disabled: boolean;
  projectId: string;
  recipeName: string;
  onSelectRecipe?: (recipeName: string) => void;
  onSaved: (config: ProjectConfig, recipeName: string) => void;
}

function configWithSettings(config: ProjectConfig | null): ProjectConfig {
  const base = config ?? { schemaVersion: 1, rootFile: null, engine: 'pdflatex' as const };
  return { ...base, ...validateRecipeSettings(base) };
}

export function CompileRecipeEditor({
  activePath,
  config,
  disabled,
  projectId,
  recipeName,
  onSelectRecipe,
  onSaved,
}: CompileRecipeEditorProps) {
  const [baseline, setBaseline] = useState<ProjectConfig>(() => configWithSettings(config));
  const [draft, setDraft] = useState<ProjectConfig>(() => configWithSettings(config));
  const [saveAsName, setSaveAsName] = useState('');
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<RecipeTool | null>(null);
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

  function updateTool(name: string, updatedTool: RecipeTool) {
    update({
      'latex-workshop.latex.tools': tools.map((tool) => (tool.name === name ? updatedTool : tool)),
      // If tool name changed, update recipes that reference it
      'latex-workshop.latex.recipes': recipes.map((entry) => ({
        ...entry,
        tools: entry.tools.map((step) => (step === name ? updatedTool.name : step)),
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
      setSaveAsOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Recipe settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const locked = disabled || saving;
  return (
    <section className="compile-recipe-editor" aria-label="Compile recipe settings">
      <div className="compile-editor-heading">
        <h3 className="writing-section-title">Recipe Editor</h3>
        <span className="recipe-hint">Edits are saved to this project.</span>
      </div>
      {error && (
        <p className="compile-recipe-error" role="alert">
          {error}
        </p>
      )}
      <fieldset disabled={locked}>
        <label className="field-label">
          Recipe
          <select
            aria-label="Select recipe"
            value={recipe.name}
            onChange={(event) => {
              const name = event.target.value;
              const idx = recipes.findIndex((r) => r.name === name);
              if (idx >= 0) setEditingRecipeIndex(idx);
              onSelectRecipe?.(name);
            }}
          >
            {recipes.map((entry) => (
              <option key={entry.name} value={entry.name}>
                {BUILD_RECIPES.find((preset) => preset.value === entry.name)?.label ?? entry.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field-label">
          Recipe name
          <input
            aria-label="Current recipe name"
            value={recipe.name}
            onChange={(event) => renameRecipe(event.target.value)}
          />
        </label>

        <h4>Steps</h4>
        {recipe.tools.map((step, index) => {
          const stepTool = tools.find((t) => t.name === step);
          return (
            <div className="compile-recipe-step" key={`${step}-${index}`}>
              <span className="compile-step-num">{index + 1}</span>
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
                className="icon-button small"
                aria-label={`Edit ${step} settings`}
                title={`Edit ${step} settings`}
                onClick={() => {
                  if (stepTool) setEditingTool(stepTool);
                }}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                className="icon-button small"
                aria-label={`Move step ${index + 1} up`}
                title="Move up"
                onClick={() => moveStep(index, -1)}
                disabled={index === 0}
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                className="icon-button small"
                aria-label={`Move step ${index + 1} down`}
                title="Move down"
                onClick={() => moveStep(index, 1)}
                disabled={index === recipe.tools.length - 1}
              >
                <ArrowDown size={13} />
              </button>
              <button
                type="button"
                className="icon-button small"
                aria-label={`Remove step ${index + 1}`}
                title="Remove step"
                onClick={() => removeStep(index)}
                disabled={recipe.tools.length === 1}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          className="recipe-add-step-faded"
          onClick={() => {
            const nextTool = tools[0]?.name ?? 'pdflatex';
            updateRecipe({ tools: [...recipe.tools, nextTool] });
          }}
          title="Add a step to this recipe"
        >
          <Plus size={13} /> Add
        </button>

        <h4 style={{ marginTop: '16px' }}>Output and default</h4>
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
          title="Save and overwrite the current recipe"
        >
          <Save size={13} /> Save
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setSaveAsName(`${recipe.name} (copy)`);
            setSaveAsOpen(true);
          }}
          disabled={locked}
          title="Save as a new recipe"
        >
          <Plus size={13} /> Save As…
        </button>
      </div>

      {editingTool && (
        <ToolEditorDialog
          open={!!editingTool}
          tool={editingTool}
          onSave={(updated) => {
            updateTool(editingTool.name, updated);
            setEditingTool(null);
          }}
          onClose={() => setEditingTool(null)}
        />
      )}

      <Dialog.Root open={saveAsOpen} onOpenChange={setSaveAsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content action-dialog" aria-describedby="save-as-desc">
            <div className="dialog-header">
              <Dialog.Title>Save Recipe As</Dialog.Title>
              <Dialog.Close className="icon-button small" aria-label="Close">
                <X size={14} />
              </Dialog.Close>
            </div>
            <p id="save-as-desc" className="setup-hint">
              Enter a name for the new recipe.
            </p>
            <label className="field-label" style={{ marginTop: '8px' }}>
              Recipe Name
              <input
                aria-label="New recipe name"
                placeholder="Enter recipe name…"
                value={saveAsName}
                autoFocus
                onChange={(event) => setSaveAsName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void save(true);
                  }
                }}
              />
            </label>
            <div className="dialog-actions" style={{ marginTop: '16px' }}>
              <button type="button" onClick={() => setSaveAsOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void save(true)}
                disabled={!saveAsName.trim()}
              >
                Save
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
