import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Hammer, Palette, Pencil, Save, Undo2, Wrench, X } from '../../icons';
import {
  BUILD_RECIPES,
  CONFIGURABLE_TOOLS,
  type BuildEngine,
  type ConfigurableTool,
  type DiagnosticSeverity,
  type SetupLink,
  type TexlabStatus,
} from '../../../../shared/api';
import { preferencesSaved, useUI } from '../../state/ui';
import { useWorkspace } from '../../state/workspace';
import { TexLabSettings } from './TexLabSettings';
import './setup.css';

type SectionId = 'appearance' | 'tools' | 'compilation' | 'backup';
const SECTIONS: Array<{ id: SectionId; label: string; icon: typeof Palette }> = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'tools', label: 'LaTeX tools', icon: Wrench },
  { id: 'compilation', label: 'Compilation', icon: Hammer },
  { id: 'backup', label: 'Import & export', icon: Save },
];

function parseChktexRules(value: string): number[] | null {
  if (!value.trim()) return [];
  const rules = value.split(',').map((part) => Number(part.trim()));
  if (rules.some((rule) => !Number.isInteger(rule) || rule < 1 || rule > 10_000)) return null;
  return [...new Set(rules)].sort((left, right) => left - right);
}

function parseChktexSeverities(value: string): Record<string, DiagnosticSeverity> | null {
  if (!value.trim()) return {};
  const result: Record<string, DiagnosticSeverity> = {};
  for (const entry of value.split(',')) {
    const [ruleText, severityText, ...extra] = entry.trim().split(':');
    const rule = Number(ruleText);
    if (
      extra.length ||
      !Number.isInteger(rule) ||
      rule < 1 ||
      rule > 10_000 ||
      (severityText !== 'error' && severityText !== 'warning' && severityText !== 'info')
    )
      return null;
    result[String(rule)] = severityText;
  }
  return result;
}

export default function SetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { tools, build } = useWorkspace();
  const { preferences, updatePreferences } = useUI();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const [platform, setPlatform] = useState('');
  const [texLabStatus, setTexLabStatus] = useState<TexlabStatus | null>(null);
  const [section, setSection] = useState<SectionId>('appearance');
  useEffect(() => {
    if (open) {
      void window.textra.getAppInfo().then((result) => {
        if (result.ok) setPlatform(result.value.platform);
      });
      void window.textra.getTexlabStatus().then((result) => {
        if (result.ok) setTexLabStatus(result.value);
      });
    }
  }, [open]);
  async function perform(action: () => Promise<string | void>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage((await action()) ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The operation failed.');
    } finally {
      setBusy(false);
    }
  }
  async function refreshTools() {
    const result = await window.textra.detectTools();
    if (!result.ok) throw new Error(result.error);
    useWorkspace.setState({ tools: result.value, toolsReady: true });
  }
  async function chooseToolPath(name: ConfigurableTool) {
    const chosen = await window.textra.chooseToolPath(name);
    if (!chosen.ok) throw new Error(chosen.error);
    if (!chosen.value) return;
    updatePreferences({ toolPaths: { ...preferences.toolPaths, [name]: chosen.value } });
    await preferencesSaved();
    await refreshTools();
    return `${name} will use the selected file.`;
  }
  async function resetToolPath(name: ConfigurableTool) {
    const next = { ...preferences.toolPaths };
    delete next[name];
    updatePreferences({ toolPaths: next });
    await preferencesSaved();
    await refreshTools();
    return `${name} will be found on PATH again.`;
  }
  async function setupLink(target: SetupLink) {
    const result = await window.textra.openSetupLink(target);
    if (!result.ok) throw new Error(result.error);
  }
  async function refreshTexlab(check = false): Promise<TexlabStatus> {
    const result = check
      ? await window.textra.checkTexlab()
      : await window.textra.getTexlabStatus();
    if (!result.ok) throw new Error(result.error);
    setTexLabStatus(result.value);
    return result.value;
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="setup-dialog">
          <div className="setup-heading">
            <Dialog.Title>Settings</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close settings" disabled={busy}>
              <X size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            No account or API key is required. Editing works without a TeX installation.
          </Dialog.Description>
          <div className="settings-body">
            <nav className="settings-nav" aria-label="Settings sections">
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  aria-current={section === id ? 'page' : undefined}
                  onClick={() => setSection(id)}
                >
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </nav>
            <div className="setup-scroll">
              {section === 'appearance' && (
                <>
                  <h3>Appearance</h3>
                  <label className="field-label">
                    Theme
                    <select
                      aria-label="Theme"
                      value={preferences.theme}
                      onChange={(event) =>
                        updatePreferences({ theme: event.target.value as 'dark' | 'light' })
                      }
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                    </select>
                  </label>
                </>
              )}
              {section === 'tools' && (
                <>
                  <h3>LaTeX tools</h3>
                  <p className="setup-hint">
                    Programs TeXtra found on your computer. Use the pencil to pick a different
                    executable.
                  </p>
                  <div className="tool-list">
                    {tools.map((tool) => {
                      const configurable = (CONFIGURABLE_TOOLS as readonly string[]).includes(
                        tool.name,
                      );
                      return (
                        <div className="tool-row" key={tool.name}>
                          <strong>{tool.name}</strong>
                          <code
                            title={tool.path ?? undefined}
                            className={tool.path ? '' : 'missing'}
                          >
                            {tool.path ?? 'Not found'}
                          </code>
                          {configurable && (
                            <span className="tool-actions">
                              <button
                                className="icon-button small"
                                disabled={busy}
                                aria-label={`Choose ${tool.name} executable`}
                                title={tool.custom ? 'Change executable' : 'Set executable path'}
                                onClick={() =>
                                  void perform(() => chooseToolPath(tool.name as ConfigurableTool))
                                }
                              >
                                <Pencil size={13} />
                              </button>
                              {tool.custom && (
                                <button
                                  className="icon-button small"
                                  disabled={busy}
                                  aria-label={`Use PATH for ${tool.name}`}
                                  title="Go back to finding it on PATH"
                                  onClick={() =>
                                    void perform(() => resetToolPath(tool.name as ConfigurableTool))
                                  }
                                >
                                  <Undo2 size={13} />
                                </button>
                              )}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <TexLabSettings
                    enabled={preferences.texlabEnabled}
                    installation={texLabStatus?.installation ?? 'checking'}
                    version={texLabStatus?.version}
                    path={texLabStatus?.path}
                    detail={texLabStatus?.detail}
                    busy={busy}
                    onEnabledChange={(enabled) => {
                      updatePreferences({ texlabEnabled: enabled });
                      void preferencesSaved()
                        .then(() => refreshTexlab())
                        .catch((error: unknown) => {
                          setMessage(
                            error instanceof Error
                              ? error.message
                              : 'TexLab preferences could not be saved.',
                          );
                        });
                    }}
                    onCheck={() =>
                      perform(async () => {
                        const status = await refreshTexlab(true);
                        return status.installation === 'error'
                          ? (status.detail ?? 'TexLab checks failed.')
                          : `TexLab ${status.version ?? ''} passed its executable check.`.trim();
                      })
                    }
                  />
                  <section className="texlab-settings" aria-labelledby="chktex-settings-title">
                    <div className="texlab-settings-heading">
                      <div>
                        <h3 id="chktex-settings-title">ChkTeX style checks</h3>
                        <p className="setup-hint">
                          Local style diagnostics for LaTeX. It runs after saving by default.
                        </p>
                      </div>
                      <label className="texlab-toggle">
                        <span>Enabled</span>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={preferences.chktexEnabled}
                          disabled={busy}
                          onChange={(event) =>
                            updatePreferences({ chktexEnabled: event.target.checked })
                          }
                        />
                      </label>
                    </div>
                    <label className="field-label chktex-field">
                      Check timing
                      <select
                        value={preferences.chktexRunMode}
                        disabled={busy || !preferences.chktexEnabled}
                        onChange={(event) =>
                          updatePreferences({
                            chktexRunMode: event.target.value as 'save' | 'live',
                          })
                        }
                      >
                        <option value="save">After saving</option>
                        <option value="live">While typing (debounced)</option>
                      </select>
                    </label>
                    <label className="field-label chktex-field">
                      Hide rule codes
                      <input
                        defaultValue={preferences.chktexIgnoredRules.join(', ')}
                        disabled={busy || !preferences.chktexEnabled}
                        placeholder="For example: 1, 8, 24"
                        onChange={(event) => {
                          const rules = parseChktexRules(event.target.value);
                          if (rules) updatePreferences({ chktexIgnoredRules: rules });
                        }}
                        onBlur={(event) => {
                          if (parseChktexRules(event.target.value) === null)
                            setMessage('Use comma-separated positive ChkTeX rule codes.');
                        }}
                      />
                    </label>
                    <label className="field-label chktex-field">
                      Rule severities
                      <input
                        defaultValue={Object.entries(preferences.chktexRuleSeverities)
                          .map(([rule, severity]) => `${rule}:${severity}`)
                          .join(', ')}
                        disabled={busy || !preferences.chktexEnabled}
                        placeholder="For example: 8:info, 24:error"
                        onChange={(event) => {
                          const severities = parseChktexSeverities(event.target.value);
                          if (severities) updatePreferences({ chktexRuleSeverities: severities });
                        }}
                        onBlur={(event) => {
                          if (parseChktexSeverities(event.target.value) === null)
                            setMessage('Use comma-separated rule:severity pairs, such as 8:info.');
                        }}
                      />
                    </label>
                    <p className="setup-hint chktex-hint">
                      Rule filters apply before Problems is updated. Choose error, warning, or info
                      for each listed rule.
                    </p>
                  </section>
                  <div className="setup-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await refreshTools();
                          return 'Tool detection refreshed. Restart TeXtra after changing your system PATH.';
                        })
                      }
                    >
                      Check tools again
                    </button>
                    <button
                      disabled={
                        busy ||
                        build.running ||
                        !tools.some((tool) => tool.name === 'pdflatex' && tool.path)
                      }
                      onClick={() =>
                        void perform(async () => {
                          setTesting(true);
                          try {
                            const result = await window.textra.testDistribution();
                            if (!result.ok) throw new Error(result.error);
                            setLog(result.value.log);
                            return result.value.success
                              ? 'Test document compiled successfully.'
                              : 'The test compile failed. See its output below.';
                          } finally {
                            setTesting(false);
                          }
                        })
                      }
                    >
                      Test TeX installation
                    </button>
                    {testing && (
                      <button onClick={() => void window.textra.cancelBuild()}>Cancel test</button>
                    )}
                  </div>
                  <p className="setup-hint">
                    The test compiles a small temporary document with pdfLaTeX. It does not change
                    your project or download missing packages.
                  </p>
                  <h3>Get a TeX distribution</h3>
                  <p className="setup-hint">
                    Use an existing installation when available. These buttons open the official
                    download pages in your browser. Installation can need administrator permission
                    and several gigabytes of disk space. On Linux, use your package manager.
                  </p>
                  <div className="setup-actions">
                    <button disabled={busy} onClick={() => void perform(() => setupLink('miktex'))}>
                      MiKTeX download
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void perform(() => setupLink('texlive'))}
                    >
                      TeX Live installer
                    </button>
                    {platform === 'darwin' && (
                      <button
                        disabled={busy}
                        onClick={() => void perform(() => setupLink('mactex'))}
                      >
                        MacTeX download
                      </button>
                    )}
                  </div>
                </>
              )}
              {section === 'compilation' && (
                <>
                  <h3>Compilation</h3>
                  <label className="field-label">
                    Default recipe for new documents
                    <select
                      aria-label="Default recipe for new documents"
                      value={preferences.defaultRecipe}
                      onChange={(event) =>
                        updatePreferences({ defaultRecipe: event.target.value as BuildEngine })
                      }
                    >
                      {BUILD_RECIPES.map((recipe) => (
                        <option key={recipe.value} value={recipe.value}>
                          {recipe.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="setup-hint">
                    Compile builds the active .tex document. Each document remembers its last used
                    recipe in the project settings.
                  </p>
                  <div className="setup-actions">
                    <button
                      disabled={!useWorkspace.getState().project || busy || build.running}
                      onClick={() => {
                        onOpenChange(false);
                        useUI.getState().setRecipeEditorOpen(true);
                      }}
                    >
                      Edit project build recipes
                    </button>
                  </div>
                  <p className="setup-hint">
                    Recipes and the output location (build folder or PDF beside the source) are
                    stored per project.
                  </p>
                  <h3>Generated files</h3>
                  <p className="setup-hint">
                    TeXtra keeps its default PDFs, logs, and auxiliary files in build/textra. Clean
                    this folder when you need a fresh compile. Custom output folders are never
                    removed automatically.
                  </p>
                  <div className="setup-actions">
                    <button
                      disabled={!useWorkspace.getState().project || busy || build.running}
                      onClick={() =>
                        void perform(async () => {
                          const project = useWorkspace.getState().project;
                          if (!project) throw new Error('Open a project folder first.');
                          const result = await window.textra.cleanProjectBuildArtifacts(project.id);
                          if (!result.ok) throw new Error(result.error);
                          return result.value.removed
                            ? 'TeXtra-generated build files were removed.'
                            : 'Cleanup cancelled or the TeXtra build folder was already empty.';
                        })
                      }
                    >
                      Clean TeXtra build files
                    </button>
                  </div>
                  <h3>Document formatting</h3>
                  <p className="setup-hint">
                    latexindent is an optional formatter included with many TeX distributions. It
                    reorganizes LaTeX indentation and line breaks. Use Format document from the
                    editor menu to preview its proposed changes before applying them.
                  </p>
                  <p className="setup-hint">
                    Status:{' '}
                    {tools.some((tool) => tool.name === 'latexindent' && tool.path)
                      ? 'latexindent is available.'
                      : 'latexindent was not found on PATH.'}
                  </p>
                </>
              )}
              {section === 'backup' && (
                <>
                  <h3>Portable app settings</h3>
                  <p className="setup-hint">
                    Export your theme, pane layout, and default compile recipe. Imports are
                    validated before you apply them. Recent folders and credentials are excluded.
                  </p>
                  <div className="setup-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          const result = await window.textra.exportSettings();
                          if (!result.ok) throw new Error(result.error);
                          return result.value ? 'Settings exported.' : 'Export cancelled.';
                        })
                      }
                    >
                      Export settings
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          const result = await window.textra.importSettings();
                          if (!result.ok) throw new Error(result.error);
                          if (!result.value) return 'Import cancelled.';
                          useUI.setState({ preferences: result.value });
                          return 'Theme and layout imported. Project files and tool paths are unchanged.';
                        })
                      }
                    >
                      Import settings
                    </button>
                  </div>
                </>
              )}
              {message && (
                <p role="status" className="setup-message">
                  {message}
                </p>
              )}
              {log && (
                <details>
                  <summary>Test compile output</summary>
                  <pre className="setup-log">{log}</pre>
                </details>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
