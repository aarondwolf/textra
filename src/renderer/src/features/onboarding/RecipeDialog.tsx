import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { parse, type ParseError } from 'jsonc-parser';
import { ArrowDown, ArrowLeft, ArrowUp, Pencil, Plus, Trash2, X } from '../../icons';
import type { ProjectConfig } from '../../../../shared/api';
import {
  createDefaultRecipeSettings,
  validateRecipeSettings,
  RECIPE_COMMANDS,
  type RecipeSettings,
  type RecipeTool,
} from '../../../../shared/recipes';
import {
  ARG_HELP,
  DEFAULT_BUILD_FOLDER,
  PLACEHOLDER_HELP,
  addArg,
  classifyArg,
  draftEarlyPasses,
  isArgOn,
  readOutputLocation,
  toggleArg,
  toolKind,
  writeOutputLocation,
  type OutputLocation,
  type OutputMode,
} from '../../../../shared/recipe-help';
import { sortProjectTexFiles, useWorkspace } from '../../state/workspace';
import { DropdownMenu } from '../../components/DropdownMenu';
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
function locationOf(config: ProjectConfig): OutputLocation {
  const settings = { ...createDefaultRecipeSettings(), ...config } as RecipeSettings;
  return readOutputLocation(
    settings['latex-workshop.latex.outDir'],
    settings['latex-workshop.latex.auxDir'],
  );
}

type View = 'list' | 'edit' | 'json' | 'tool';
const PRESETS = createDefaultRecipeSettings()['latex-workshop.latex.tools'];

function ToolCard({
  tool,
  users,
  help,
  setHelp,
  onChange,
}: {
  tool: RecipeTool;
  users: number;
  help: string;
  setHelp: (text: string) => void;
  onChange: (patch: Partial<RecipeTool>) => void;
}) {
  const name = tool.name;
  const kind = toolKind(tool.command);
  const [custom, setCustom] = useState('');
  const catalog = ARG_HELP[kind];
  const extras = tool.args.filter((arg) => classifyArg(arg, kind) === 'custom');
  const locked = tool.args.filter((arg) => ['managed', 'input'].includes(classifyArg(arg, kind)));
  function addCustom() {
    const value = custom.trim();
    if (!value || tool.args.includes(value)) return;
    onChange({ args: addArg(tool.args, value) });
    setCustom('');
  }
  return (
    <section className="tool-card" aria-label={`Options for ${name}`}>
      <div className="tool-card-head">
        <strong>{name}</strong>
        <span className="recipe-hint">
          {users > 1
            ? `Shared by ${users} recipes. Changes apply to all of them.`
            : 'Used by this recipe.'}
        </span>
      </div>
      <label className="field-label">
        Program
        <DropdownMenu
          ariaLabel={`Program for ${name}`}
          value={tool.command.replace(/\.exe$/i, '').toLowerCase()}
          items={RECIPE_COMMANDS.map((command) => ({ value: command, label: command }))}
          onChange={(val) => {
            const preset = PRESETS.find((entry) => entry.command === val)!;
            onChange({
              command: preset.command,
              args: structuredClone(preset.args),
              cwd: preset.cwd,
            });
          }}
        />
      </label>
      <div className="chip-row" role="group" aria-label={`Options for ${name}`}>
        {catalog.map((entry) => (
          <button
            type="button"
            key={entry.arg}
            className="chip"
            aria-pressed={isArgOn(tool.args, entry)}
            title={entry.description}
            onMouseEnter={() => setHelp(`${entry.arg}: ${entry.description}`)}
            onFocus={() => setHelp(`${entry.arg}: ${entry.description}`)}
            onClick={() => onChange({ args: toggleArg(tool.args, kind, entry) })}
          >
            {entry.label}
            <code>{entry.arg}</code>
          </button>
        ))}
        {extras.map((arg) => (
          <button
            type="button"
            key={arg}
            className="chip"
            aria-pressed="true"
            title="Custom argument. Click to remove it."
            onClick={() => onChange({ args: tool.args.filter((entry) => entry !== arg) })}
          >
            <code>{arg}</code>
            <X size={11} aria-hidden="true" />
          </button>
        ))}
        {locked.map((arg) => {
          const managed = classifyArg(arg, kind) === 'managed';
          const text = managed
            ? 'Managed for you. Tells the program to write into the Output location chosen on the first screen.'
            : 'The document being compiled. It is always required.';
          return (
            <span
              key={arg}
              className="chip locked"
              tabIndex={0}
              title={text}
              onMouseEnter={() => setHelp(`${arg}: ${text}`)}
              onFocus={() => setHelp(`${arg}: ${text}`)}
            >
              {managed ? 'Output folder' : 'Document'}
              <code>{arg}</code>
            </span>
          );
        })}
      </div>
      <p className="recipe-hint chip-help" role="status">
        {help || 'Click an option to add or remove it. Hover or focus one for an explanation.'}
      </p>
      <div className="chip-add">
        <input
          aria-label={`Custom argument for ${name}`}
          placeholder="Add another argument, for example -draftmode"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addCustom();
            }
          }}
        />
        <button type="button" onClick={addCustom} disabled={!custom.trim()}>
          Add
        </button>
      </div>
      <details>
        <summary>Edit all arguments as text</summary>
        <textarea
          aria-label={`Arguments for ${name}`}
          spellCheck={false}
          rows={6}
          value={tool.args.join('\n')}
          onChange={(event) =>
            onChange({
              args: event.target.value.split('\n').filter((arg) => arg.length > 0),
            })
          }
        />
        <p className="recipe-hint">One argument per line. No quotes are needed around paths.</p>
      </details>
    </section>
  );
}

export default function RecipeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const project = useWorkspace((state) => state.project);
  const workspaceRootFile = useWorkspace((state) => state.rootFile);
  const sortedTexFiles = useMemo(() => {
    return project?.files ? sortProjectTexFiles(project.files) : [];
  }, [project?.files]);
  const [baseline, setBaseline] = useState<ProjectConfig | null>(null);
  const [draft, setDraft] = useState<ProjectConfig>(initial);
  const [recipeIndex, setRecipeIndex] = useState(0);
  const [view, setView] = useState<View>('list');
  const [toolName, setToolName] = useState('');
  const [location, setLocation] = useState<OutputLocation>(() => locationOf(initial()));
  const [json, setJSON] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState('');
  const customTarget = useRef<'outDir' | 'auxDir'>('outDir');
  useEffect(() => {
    if (!open || !project) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    setBaseline(null);
    setView('list');
    void window.textra
      .getProjectConfig(project.id)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) throw new Error(result.error);
        const config = { ...result.value, ...validateRecipeSettings(result.value) };
        setDraft(config);
        setBaseline(config);
        setLocation(locationOf(config));
        setRecipeIndex(0);
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
  const defaultRecipe = settings['latex-workshop.latex.recipe.default'];
  function update(patch: Partial<ProjectConfig>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setError(null);
  }
  function updateRecipe(patch: Partial<typeof recipe>) {
    update({
      'latex-workshop.latex.recipes': recipes.map((entry, index) =>
        index === recipeIndex ? { ...entry, ...patch } : entry,
      ),
    });
  }
  function updateTool(name: string, patch: Partial<RecipeTool>) {
    update({
      'latex-workshop.latex.tools': tools.map((entry) =>
        entry.name === name ? { ...entry, ...patch } : entry,
      ),
    });
  }
  function applyLocation(next: OutputLocation) {
    setLocation(next);
    if (next.mode !== 'custom') {
      const paths = writeOutputLocation(next);
      update({
        'latex-workshop.latex.outDir': paths.outDir,
        'latex-workshop.latex.auxDir': paths.auxDir,
      });
    }
  }
  function switchView(next: View) {
    try {
      if (next === 'json') setJSON(JSON.stringify(draft, null, 2));
      else if (view === 'json') {
        const parsed = readJSON(json);
        const config = { ...parsed, ...validateRecipeSettings(parsed) };
        setDraft(config);
        setLocation(locationOf(config));
        setRecipeIndex(0);
      }
      setView(next);
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
      const candidate = view === 'json' ? readJSON(json) : draft;
      const config = { ...candidate, ...validateRecipeSettings(candidate) };
      const result = await window.textra.setProjectConfig({
        projectId: project.id,
        config,
        expectedConfig: baseline,
      });
      if (!result.ok) throw new Error(result.error);
      if (useWorkspace.getState().project?.id === project.id) {
        const nextRoot = result.value.rootFile ?? project.mainFile ?? sortedTexFiles[0]?.path ?? '';
        useWorkspace.setState({
          projectConfig: result.value,
          recipes: result.value.recipes ?? {},
          rootFile: nextRoot,
        });
      }
      onOpenChange(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  function addRecipe() {
    let name = 'New recipe';
    for (let suffix = 2; recipes.some((entry) => entry.name === name); suffix++)
      name = `New recipe ${suffix}`;
    update({ 'latex-workshop.latex.recipes': [...recipes, { name, tools: [tools[0].name] }] });
    setRecipeIndex(recipes.length);
    setView('edit');
  }
  function addStep(value: string) {
    if (!value) return;
    if (value.startsWith('new:')) {
      const command = value.slice(4);
      const preset = PRESETS.find((entry) => entry.command === command)!;
      let name = command;
      for (let suffix = 2; tools.some((entry) => entry.name === name); suffix++)
        name = `${command}-${suffix}`;
      update({
        'latex-workshop.latex.tools': [...tools, { ...structuredClone(preset), name }],
        'latex-workshop.latex.recipes': recipes.map((entry, index) =>
          index === recipeIndex ? { ...entry, tools: [...entry.tools, name] } : entry,
        ),
      });
    } else updateRecipe({ tools: [...recipe.tools, value] });
  }
  function renameRecipe(name: string) {
    update({
      'latex-workshop.latex.recipes': recipes.map((entry, index) =>
        index === recipeIndex ? { ...entry, name } : entry,
      ),
      'latex-workshop.latex.recipe.default': defaultRecipe === recipe.name ? name : defaultRecipe,
      recipes: Object.fromEntries(
        Object.entries(draft.recipes ?? {}).map(([path, selected]) => [
          path,
          selected === recipe.name ? name : selected,
        ]),
      ),
    });
  }
  function deleteRecipe() {
    update({
      'latex-workshop.latex.recipes': recipes.filter((_, index) => index !== recipeIndex),
      recipes: Object.fromEntries(
        Object.entries(draft.recipes ?? {}).filter(([, name]) => name !== recipe.name),
      ),
      'latex-workshop.latex.recipe.default':
        defaultRecipe === recipe.name ? 'lastUsed' : defaultRecipe,
    });
    setRecipeIndex(0);
    setView('list');
  }
  const tool = tools.find((entry) => entry.name === toolName);
  function renameTool(name: string) {
    update({
      'latex-workshop.latex.tools': tools.map((entry) =>
        entry.name === toolName ? { ...entry, name } : entry,
      ),
      'latex-workshop.latex.recipes': recipes.map((entry) => ({
        ...entry,
        tools: entry.tools.map((step) => (step === toolName ? name : step)),
      })),
    });
    setToolName(name);
  }
  function duplicateTool() {
    if (!tool) return;
    let name = `${tool.name}-copy`;
    for (let suffix = 2; tools.some((entry) => entry.name === name); suffix++)
      name = `${tool.name}-copy-${suffix}`;
    update({ 'latex-workshop.latex.tools': [...tools, { ...structuredClone(tool), name }] });
    setToolName(name);
  }
  function newTool(command: string) {
    const preset = PRESETS.find((entry) => entry.command === command)!;
    let name = command;
    for (let suffix = 2; tools.some((entry) => entry.name === name); suffix++)
      name = `${command}-${suffix}`;
    update({ 'latex-workshop.latex.tools': [...tools, { ...structuredClone(preset), name }] });
    setToolName(name);
    setView('tool');
  }
  function deleteTool() {
    if (!tool) return;
    update({ 'latex-workshop.latex.tools': tools.filter((entry) => entry.name !== tool.name) });
    setView('list');
  }
  function draftFirstPasses() {
    const result = draftEarlyPasses(recipe.tools, tools);
    update({
      'latex-workshop.latex.tools': result.tools,
      'latex-workshop.latex.recipes': recipes.map((entry, index) =>
        index === recipeIndex ? { ...entry, tools: result.steps } : entry,
      ),
    });
  }

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
            A recipe is the list of programs that run when you press Compile. Saved in{' '}
            <code>.textra/settings.json</code>.
          </Dialog.Description>
          {!project && <p>Open a project folder to edit its recipes.</p>}
          {error && (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          )}
          <fieldset className="recipe-scroll" disabled={busy || !baseline}>
            {view === 'json' && (
              <>
                <button type="button" className="back-link" onClick={() => switchView('list')}>
                  <ArrowLeft size={14} /> Back to recipes
                </button>
                <p className="recipe-hint">
                  Paste LaTeX Workshop recipe and tool definitions here. The same recipe names,
                  ordered tools, arguments and path tags are used.
                </p>
                <textarea
                  className="recipe-json"
                  aria-label="Project settings JSON"
                  spellCheck={false}
                  value={json}
                  onChange={(event) => setJSON(event.target.value)}
                />
              </>
            )}
            {view === 'list' && (
              <>
                <h3>Recipes</h3>
                <ul className="recipe-list">
                  {recipes.map((entry, index) => (
                    <li key={entry.name} className="recipe-row">
                      <div>
                        <strong>{entry.name}</strong>
                        {defaultRecipe === entry.name && <span className="badge">Default</span>}
                        <span className="recipe-hint">{entry.tools.join(' → ')}</span>
                      </div>
                      <button
                        type="button"
                        className="icon-button small"
                        aria-label={`Edit recipe ${entry.name}`}
                        title={`Edit ${entry.name}`}
                        onClick={() => {
                          setRecipeIndex(index);
                          setView('edit');
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={addRecipe}>
                  <Plus size={14} />
                  New recipe
                </button>
                <h3>Tools</h3>
                <p className="recipe-hint">
                  A tool is one program run with its options. Recipes are built from tools, so
                  changing a tool changes every recipe that uses it.
                </p>
                <ul className="recipe-list">
                  {tools.map((entry) => (
                    <li key={entry.name} className="recipe-row">
                      <div>
                        <strong>{entry.name}</strong>
                        <span className="recipe-hint">
                          {entry.command}
                          {entry.args.includes('-draftmode') ? ' (draft mode)' : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="icon-button small"
                        aria-label={`Edit tool ${entry.name}`}
                        title={`Edit ${entry.name}`}
                        onClick={() => {
                          setToolName(entry.name);
                          setView('tool');
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
                <label className="field-label">
                  New tool
                  <DropdownMenu
                    ariaLabel="New tool"
                    placeholder="Choose a program…"
                    value=""
                    items={RECIPE_COMMANDS.map((command) => ({ value: command, label: command }))}
                    onChange={(val) => val && newTool(val)}
                  />
                </label>
                <label className="field-label">
                  Default recipe for new documents
                  <DropdownMenu
                    ariaLabel="Project default recipe"
                    value={defaultRecipe}
                    items={[
                      { value: 'lastUsed', label: 'Last used / app default' },
                      { value: 'first', label: 'First recipe' },
                      ...recipes.map((entry) => ({ value: entry.name, label: entry.name })),
                    ]}
                    onChange={(val) => update({ 'latex-workshop.latex.recipe.default': val })}
                  />
                </label>
                <label className="field-label">
                  Root document (.tex)
                  <DropdownMenu
                    ariaLabel="Root document (.tex)"
                    value={draft.rootFile ?? ''}
                    disabled={!project || sortedTexFiles.length === 0}
                    placeholder={
                      !project
                        ? 'No project open'
                        : sortedTexFiles.length === 0
                          ? 'No .tex files found'
                          : 'Select root document...'
                    }
                    items={
                      !project
                        ? [{ value: '', label: 'No project open', disabled: true }]
                        : sortedTexFiles.length === 0
                          ? [{ value: '', label: 'No .tex files found', disabled: true }]
                          : [
                              {
                                value: '',
                                label: `Auto-detect ${workspaceRootFile ? `(${workspaceRootFile})` : ''}`,
                              },
                              ...sortedTexFiles.map((file) => ({
                                value: file.path,
                                label: file.path,
                              })),
                              ...(draft.rootFile &&
                              !sortedTexFiles.some((f) => f.path === draft.rootFile)
                                ? [
                                    {
                                      value: draft.rootFile,
                                      label: draft.rootFile,
                                      description: '(missing)',
                                      disabled: true,
                                    },
                                  ]
                                : []),
                            ]
                    }
                    onChange={(val) => update({ rootFile: val || null })}
                  />
                </label>
                <h3>Output location</h3>
                <div role="radiogroup" aria-label="Output location" className="location-options">
                  {(
                    [
                      [
                        'build',
                        'Everything in the build folder',
                        'The PDF and all auxiliary files go into the build folder. Your source folders stay clean. This is the default.',
                      ],
                      [
                        'beside',
                        'PDF next to the .tex file, other files in the build folder',
                        'The PDF appears beside your source. Auxiliary files (.aux, .log and so on) stay in the build folder. Needs the MiKTeX engines (pdflatex, xelatex, lualatex).',
                      ],
                      [
                        'custom',
                        'Custom paths',
                        'Type the output and auxiliary folders yourself using path tags.',
                      ],
                    ] as Array<[OutputMode, string, string]>
                  ).map(([mode, label, text]) => (
                    <label key={mode} className="location-option">
                      <input
                        type="radio"
                        name="output-mode"
                        checked={location.mode === mode}
                        onChange={() =>
                          applyLocation(
                            mode === 'custom'
                              ? { ...location, mode }
                              : {
                                  mode,
                                  folder: location.folder || DEFAULT_BUILD_FOLDER,
                                  perDocument: location.perDocument,
                                },
                          )
                        }
                      />
                      <span>
                        {label}
                        <small>{text}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {location.mode !== 'custom' ? (
                  <>
                    <label className="field-label">
                      Build folder
                      <input
                        aria-label="Build folder"
                        value={location.folder}
                        onChange={(event) =>
                          applyLocation({ ...location, folder: event.target.value })
                        }
                      />
                    </label>
                    <label className="recipe-checkbox">
                      <input
                        type="checkbox"
                        aria-label="Separate folder for each document"
                        checked={location.perDocument}
                        onChange={(event) =>
                          applyLocation({ ...location, perDocument: event.target.checked })
                        }
                      />
                      <span>
                        Separate folder for each document
                        <small>
                          Adds the document&apos;s own path (<code>%RELATIVE_DOC%</code>) to the
                          build folder, so <code>intro/main.tex</code> and{' '}
                          <code>appendix/main.tex</code> never overwrite each other. Turn this off
                          if you only ever compile one document.
                        </small>
                      </span>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="field-label">
                      Output directory
                      <input
                        aria-label="Output directory"
                        value={settings['latex-workshop.latex.outDir']}
                        onFocus={() => (customTarget.current = 'outDir')}
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
                        onFocus={() => (customTarget.current = 'auxDir')}
                        onChange={(event) =>
                          update({ 'latex-workshop.latex.auxDir': event.target.value })
                        }
                      />
                    </label>
                    <div className="chip-row" role="group" aria-label="Path tags">
                      {PLACEHOLDER_HELP.filter((entry) =>
                        ['%DIR%', '%OUTDIR%', '%RELATIVE_DOC%', '%WORKSPACE_FOLDER%'].includes(
                          entry.tag,
                        ),
                      ).map((entry) => (
                        <button
                          type="button"
                          key={entry.tag}
                          className="chip"
                          title={entry.description}
                          onMouseEnter={() => setHelp(`${entry.tag}: ${entry.description}`)}
                          onFocus={() => setHelp(`${entry.tag}: ${entry.description}`)}
                          onClick={() => {
                            const key =
                              customTarget.current === 'outDir'
                                ? 'latex-workshop.latex.outDir'
                                : 'latex-workshop.latex.auxDir';
                            update({ [key]: settings[key] + entry.tag });
                          }}
                        >
                          <code>{entry.tag}</code>
                        </button>
                      ))}
                    </div>
                    <p className="recipe-hint" role="status">
                      {help || 'Click a tag to add it to the field you last used.'}
                    </p>
                  </>
                )}
                <details>
                  <summary>What do the %TAGS% mean?</summary>
                  <dl className="tag-list">
                    {PLACEHOLDER_HELP.map((entry) => (
                      <div key={entry.tag}>
                        <dt>
                          <code>{entry.tag}</code>
                        </dt>
                        <dd>{entry.description}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
                <button type="button" className="back-link" onClick={() => switchView('json')}>
                  Edit settings.json directly
                </button>
              </>
            )}
            {view === 'tool' && tool && (
              <>
                <button type="button" className="back-link" onClick={() => setView('list')}>
                  <ArrowLeft size={14} /> All recipes and tools
                </button>
                <label className="field-label">
                  Tool name
                  <input
                    aria-label="Tool name"
                    value={tool.name}
                    onChange={(event) => renameTool(event.target.value)}
                  />
                </label>
                <ToolCard
                  tool={tool}
                  users={recipes.filter((entry) => entry.tools.includes(tool.name)).length}
                  help={help}
                  setHelp={setHelp}
                  onChange={(patch) => updateTool(tool.name, patch)}
                />
                <div className="recipe-section-heading">
                  <button type="button" onClick={duplicateTool}>
                    Duplicate tool
                  </button>
                  <button
                    type="button"
                    disabled={
                      tools.length <= 1 || recipes.some((entry) => entry.tools.includes(tool.name))
                    }
                    title={
                      recipes.some((entry) => entry.tools.includes(tool.name))
                        ? 'Remove it from every recipe first.'
                        : undefined
                    }
                    onClick={deleteTool}
                  >
                    <Trash2 size={13} />
                    Delete tool
                  </button>
                </div>
              </>
            )}
            {view === 'edit' && (
              <>
                <button type="button" className="back-link" onClick={() => setView('list')}>
                  <ArrowLeft size={14} /> All recipes
                </button>
                <label className="field-label">
                  Recipe name
                  <input
                    aria-label="Recipe name"
                    value={recipe.name}
                    onChange={(event) => renameRecipe(event.target.value)}
                  />
                </label>
                <h3>Steps</h3>
                <p className="recipe-hint">
                  Steps run top to bottom. LaTeX usually needs two passes so references resolve.
                </p>
                {recipe.tools.map((step, index) => (
                  <div className="recipe-step" key={index}>
                    <span>{index + 1}</span>
                    <DropdownMenu
                      ariaLabel={`Step ${index + 1} tool`}
                      value={step}
                      items={tools.map((entry) => ({ value: entry.name, label: entry.name }))}
                      onChange={(val) =>
                        updateRecipe({
                          tools: recipe.tools.map((name, position) =>
                            position === index ? val : name,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      aria-label={`Edit tool ${step}`}
                      title={`Edit tool ${step}`}
                      onClick={() => {
                        setToolName(step);
                        setView('tool');
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    {([-1, 1] as const).map((direction) => (
                      <button
                        type="button"
                        key={direction}
                        aria-label={`Move step ${index + 1} ${direction === -1 ? 'up' : 'down'}`}
                        disabled={index + direction < 0 || index + direction >= recipe.tools.length}
                        onClick={() => {
                          const steps = [...recipe.tools];
                          [steps[index], steps[index + direction]] = [
                            steps[index + direction],
                            steps[index],
                          ];
                          updateRecipe({ tools: steps });
                        }}
                      >
                        {direction === -1 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label={`Remove step ${index + 1}`}
                      disabled={recipe.tools.length <= 1}
                      onClick={() =>
                        updateRecipe({ tools: recipe.tools.filter((_, at) => at !== index) })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <label className="field-label">
                  Add a step
                  <DropdownMenu
                    ariaLabel="Add step"
                    placeholder="Choose a program…"
                    value=""
                    items={[
                      {
                        group: 'Existing tools',
                        items: tools.map((entry) => ({ value: entry.name, label: entry.name })),
                      },
                      {
                        group: 'New tool',
                        items: RECIPE_COMMANDS.map((command) => ({
                          value: `new:${command}`,
                          label: `New ${command} tool`,
                        })),
                      },
                    ]}
                    onChange={(val) => val && addStep(val)}
                  />
                </label>
                <div className="draft-helper">
                  <button type="button" onClick={draftFirstPasses}>
                    Use draft mode for early passes
                  </button>
                  <p className="recipe-hint">
                    Every compiler pass except the last gets a <code>-draft</code> copy of its tool
                    that adds <code>-draftmode</code>. Draft passes skip writing the PDF but still
                    write the .aux files, so references and citations resolve and the final pass
                    produces the only PDF. Edit the copies under Tools.
                  </p>
                </div>
                <div className="recipe-section-heading">
                  <span />
                  <button type="button" disabled={recipes.length <= 1} onClick={deleteRecipe}>
                    <Trash2 size={13} />
                    Delete recipe
                  </button>
                </div>
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
