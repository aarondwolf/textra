import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AIChat,
  Article,
  Hammer,
  Palette,
  Pencil,
  Plus,
  Save,
  Trash2,
  Undo2,
  Wrench,
  X,
} from '../../icons';
import {
  BUILD_RECIPES,
  CONFIGURABLE_TOOLS,
  type BuildEngine,
  type ConfigurableTool,
  type CustomTheme,
  type DiagnosticSeverity,
  type SetupLink,
  type Theme,
  type TexlabStatus,
} from '../../../../shared/api';
import { preferencesSaved, useUI } from '../../state/ui';
import { useWorkspace } from '../../state/workspace';
import { TexLabSettings } from './TexLabSettings';
import { AISettingsDialog } from '../chat/AISettingsDialog';
import { CompileRecipeEditor } from '../compile/CompileRecipeEditor';
import { SaveFooter } from '../save-status/SaveFooter';
import './setup.css';

export type SectionId =
  'appearance' | 'editor' | 'preferences' | 'shortcuts' | 'tools' | 'compilation' | 'backup' | 'ai';
const SECTIONS: Array<{ id: SectionId; label: string; icon: typeof Palette }> = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'editor', label: 'Editor', icon: Article },
  { id: 'preferences', label: 'Files & Diagnostics', icon: Article },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Article },
  { id: 'tools', label: 'LaTeX tools', icon: Wrench },
  { id: 'compilation', label: 'Compilation', icon: Hammer },
  { id: 'ai', label: 'AI Settings', icon: AIChat },
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
  initialSection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SectionId;
}) {
  const { tools, build } = useWorkspace();
  const { preferences, updatePreferences, saveState, error: preferenceError } = useUI();
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [log, setLog] = useState('');
  const [platform, setPlatform] = useState('');
  const [texLabStatus, setTexLabStatus] = useState<TexlabStatus | null>(null);
  const [section, setSection] = useState<SectionId>(initialSection ?? 'appearance');
  useEffect(() => {
    if (open && initialSection) {
      setSection(initialSection);
    }
  }, [open, initialSection]);
  const [newThemeName, setNewThemeName] = useState('');
  const [newThemeBase, setNewThemeBase] = useState<
    'dark' | 'light' | 'midnight' | 'forest' | 'ocean' | 'rose' | 'sand'
  >('dark');
  const [newThemeBg, setNewThemeBg] = useState('#1c1e20');
  const [newThemeSurface, setNewThemeSurface] = useState('#222426');
  const [newThemeText, setNewThemeText] = useState('#e4e5e2');
  const [newThemeAccent, setNewThemeAccent] = useState('#9bc9bb');
  const [newShortcutLabel, setNewShortcutLabel] = useState('');
  const [newShortcutKeys, setNewShortcutKeys] = useState('');
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
              {section === 'ai' && (
                <AISettingsDialog
                  onClose={() => setSection('appearance')}
                  onOpenChange={(isOpen) => {
                    if (!isOpen) setSection('appearance');
                  }}
                />
              )}
              {section === 'appearance' && (
                <>
                  <h3>Appearance</h3>
                  <label className="field-label">
                    Theme
                    <select
                      aria-label="Theme"
                      value={preferences.theme}
                      onChange={(event) =>
                        updatePreferences({ theme: event.target.value as Theme })
                      }
                    >
                      <option value="dark">Dark (default)</option>
                      <option value="light">Light</option>
                      <option value="midnight">Midnight</option>
                      <option value="forest">Forest</option>
                      <option value="ocean">Ocean</option>
                      <option value="rose">Rose</option>
                      <option value="sand">Sand</option>
                      {(preferences.customThemes ?? []).map((ct) => (
                        <option key={ct.id} value={ct.id}>
                          {ct.name} (Custom)
                        </option>
                      ))}
                    </select>
                  </label>
                  {(preferences.customThemes ?? []).some((ct) => ct.id === preferences.theme) && (
                    <button
                      type="button"
                      className="text-button"
                      style={{ alignSelf: 'start', marginTop: '4px', color: 'var(--alert-error)' }}
                      onClick={() => {
                        const remaining = (preferences.customThemes ?? []).filter(
                          (ct) => ct.id !== preferences.theme,
                        );
                        updatePreferences({
                          theme: 'dark',
                          customThemes: remaining,
                        });
                      }}
                    >
                      <Trash2 size={13} /> Delete selected custom theme
                    </button>
                  )}

                  <h3>Fonts</h3>
                  <p className="setup-hint">
                    Specify custom font families for the interface and editor. Leave blank to use
                    system defaults.
                  </p>
                  <div className="setup-actions" style={{ display: 'flex', gap: '10px' }}>
                    <label className="field-label" style={{ flex: 1 }}>
                      UI Font
                      <input
                        aria-label="UI Font"
                        placeholder="'Segoe UI', system-ui, sans-serif"
                        value={preferences.uiFont ?? ''}
                        onChange={(event) =>
                          updatePreferences({ uiFont: event.target.value || undefined })
                        }
                      />
                    </label>
                    <label className="field-label" style={{ flex: 1 }}>
                      Editor Font
                      <input
                        aria-label="Editor Font"
                        placeholder="'Cascadia Code', Consolas, monospace"
                        value={preferences.editorFont ?? ''}
                        onChange={(event) =>
                          updatePreferences({ editorFont: event.target.value || undefined })
                        }
                      />
                    </label>
                  </div>

                  <h3>Accent colors</h3>
                  <p className="setup-hint">
                    Personalize the accent used by the selected color scheme. Your choices stay
                    local and are included in exported settings.
                  </p>
                  <div className="setup-actions">
                    {(
                      [
                        ['accent', 'Accent'],
                        ['accentStrong', 'Strong accent'],
                        ['accentBackground', 'Accent background'],
                      ] as const
                    ).map(([key, label]) => (
                      <label className="field-label" key={key}>
                        {label}
                        <input
                          aria-label={label}
                          type="color"
                          value={preferences.themeCustomizations[key]}
                          onChange={(event) =>
                            updatePreferences({
                              themeCustomizations: {
                                ...preferences.themeCustomizations,
                                [key]: event.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>

                  <details
                    className="custom-theme-box"
                    style={{
                      marginTop: '16px',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '10px',
                    }}
                  >
                    <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                      Create and save a new theme…
                    </summary>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        marginTop: '10px',
                      }}
                    >
                      <label className="field-label">
                        Theme Name
                        <input
                          aria-label="New theme name"
                          placeholder="e.g. Nord Night"
                          value={newThemeName}
                          onChange={(e) => setNewThemeName(e.target.value)}
                        />
                      </label>
                      <label className="field-label">
                        Base Theme
                        <select
                          aria-label="New theme base"
                          value={newThemeBase}
                          onChange={(e) =>
                            setNewThemeBase(
                              e.target.value as
                                | 'dark'
                                | 'light'
                                | 'midnight'
                                | 'forest'
                                | 'ocean'
                                | 'rose'
                                | 'sand',
                            )
                          }
                        >
                          <option value="dark">Dark</option>
                          <option value="light">Light</option>
                          <option value="midnight">Midnight</option>
                          <option value="forest">Forest</option>
                          <option value="ocean">Ocean</option>
                          <option value="rose">Rose</option>
                          <option value="sand">Sand</option>
                        </select>
                      </label>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                          gap: '8px',
                        }}
                      >
                        <label className="field-label">
                          Background
                          <input
                            type="color"
                            value={newThemeBg}
                            onChange={(e) => setNewThemeBg(e.target.value)}
                          />
                        </label>
                        <label className="field-label">
                          Surface
                          <input
                            type="color"
                            value={newThemeSurface}
                            onChange={(e) => setNewThemeSurface(e.target.value)}
                          />
                        </label>
                        <label className="field-label">
                          Text
                          <input
                            type="color"
                            value={newThemeText}
                            onChange={(e) => setNewThemeText(e.target.value)}
                          />
                        </label>
                        <label className="field-label">
                          Accent
                          <input
                            type="color"
                            value={newThemeAccent}
                            onChange={(e) => setNewThemeAccent(e.target.value)}
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        className="text-button primary-button"
                        style={{ alignSelf: 'start', marginTop: '6px' }}
                        disabled={!newThemeName.trim()}
                        onClick={() => {
                          const id = `custom-${Date.now()}`;
                          const created: CustomTheme = {
                            id,
                            name: newThemeName.trim(),
                            baseTheme: newThemeBase,
                            background: newThemeBg,
                            surface: newThemeSurface,
                            text: newThemeText,
                            accent: newThemeAccent,
                            uiFont: preferences.uiFont,
                            editorFont: preferences.editorFont,
                          };
                          const updated = [...(preferences.customThemes ?? []), created];
                          updatePreferences({
                            customThemes: updated,
                            theme: id,
                          });
                          setNewThemeName('');
                        }}
                      >
                        <Plus size={13} /> Save theme to picker
                      </button>
                    </div>
                  </details>
                </>
              )}
              {section === 'editor' && (
                <>
                  <h3>Editor</h3>
                  <label className="texlab-toggle">
                    <span>Show minimap</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={preferences.editorMinimap}
                      onChange={(event) =>
                        updatePreferences({ editorMinimap: event.target.checked })
                      }
                    />
                  </label>
                  <p className="setup-hint">
                    A compact document overview is useful in long source files. It is off by default
                    to keep the editor uncluttered.
                  </p>
                  <h3>Autosave</h3>
                  <label className="texlab-toggle">
                    <span>Save after typing stops</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={preferences.autoSave}
                      onChange={(event) => updatePreferences({ autoSave: event.target.checked })}
                    />
                  </label>
                  <label className="chktex-field">
                    Delay before saving (milliseconds)
                    <input
                      type="number"
                      min="1000"
                      max="120000"
                      step="500"
                      disabled={!preferences.autoSave}
                      value={preferences.autoSaveDelayMs}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isInteger(value) && value >= 1000 && value <= 120000)
                          updatePreferences({ autoSaveDelayMs: value });
                      }}
                    />
                  </label>
                  <p className="setup-hint">
                    Autosave uses the same conflict checks as Ctrl/Cmd+S. It is disabled by default
                    and starts at a three-second delay.
                  </p>
                  <h3>Tabs and recovery</h3>
                  <label className="texlab-toggle editor-session-toggle">
                    <span>Restore the previous session after restart</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={preferences.restoreSession}
                      onChange={(event) =>
                        updatePreferences({ restoreSession: event.target.checked })
                      }
                    />
                  </label>
                  <label className="texlab-toggle editor-session-toggle">
                    <span>Use preview tabs for unedited files</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={preferences.previewTabs}
                      onChange={(event) => updatePreferences({ previewTabs: event.target.checked })}
                    />
                  </label>
                  <label className="chktex-field">
                    Tab close buttons
                    <select
                      value={preferences.tabCloseButtons}
                      onChange={(event) =>
                        updatePreferences({
                          tabCloseButtons: event.target.value as 'always' | 'hover',
                        })
                      }
                    >
                      <option value="hover">Show on hover</option>
                      <option value="always">Always show</option>
                    </select>
                  </label>
                  <p className="setup-hint">
                    Reopen files from your last session and choose how editor tabs are displayed.
                  </p>
                  <h3>Snippets & Symbols</h3>
                  <label className="texlab-toggle">
                    <span>Keep Math Symbols open by default</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={preferences.snippetsSymbolsOpenDefault}
                      onChange={(event) =>
                        updatePreferences({ snippetsSymbolsOpenDefault: event.target.checked })
                      }
                    />
                  </label>
                  <label className="texlab-toggle">
                    <span>Keep Templates & Snippets open by default</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={preferences.snippetsTemplatesOpenDefault}
                      onChange={(event) =>
                        updatePreferences({ snippetsTemplatesOpenDefault: event.target.checked })
                      }
                    />
                  </label>
                  <p className="setup-hint">
                    Choose whether sections in the Snippets & Symbols sidebar tab start expanded or
                    collapsed.
                  </p>
                </>
              )}
              {section === 'preferences' && (
                <>
                  <h3>External file changes</h3>
                  <p className="setup-hint">
                    Protect the buffer you have open when another app, including a background
                    writing assistant, changes the same file. TeXtra never overwrites the original
                    file after it detects a change.
                  </p>
                  <label className="texlab-toggle">
                    <span>Detect external changes</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={preferences.externalChangeDetection}
                      onChange={(event) =>
                        updatePreferences({ externalChangeDetection: event.target.checked })
                      }
                    />
                  </label>
                  <label className="chktex-field">
                    Quiet period before comparison (seconds)
                    <select
                      disabled={!preferences.externalChangeDetection}
                      value={preferences.externalChangeQuietPeriodMs}
                      onChange={(event) =>
                        updatePreferences({
                          externalChangeQuietPeriodMs: Number(event.target.value),
                        })
                      }
                    >
                      <option value={2000}>2 seconds</option>
                      <option value={3000}>3 seconds</option>
                      <option value={4000}>4 seconds</option>
                      <option value={5000}>5 seconds</option>
                    </select>
                  </label>
                  <p className="setup-hint">
                    The external version must stop changing for this long before TeXtra enables its
                    read-only comparison. While it is active, wait before comparing.
                  </p>
                  <label className="texlab-toggle">
                    <span>Use polling only</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={preferences.externalChangePollingOnly}
                      disabled={!preferences.externalChangeDetection}
                      onChange={(event) =>
                        updatePreferences({ externalChangePollingOnly: event.target.checked })
                      }
                    />
                  </label>
                  <p className="setup-hint">
                    Turn this on if filesystem watching is unreliable in a network, Dropbox, or
                    other synchronized folder. Polling still detects changes, but may respond less
                    quickly.
                  </p>
                  <h3>Conflict copies</h3>
                  <label className="texlab-toggle">
                    <span>Open the read-only diff after creating a conflict copy</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={preferences.openDiffAfterConflictCopy}
                      disabled={!preferences.externalChangeDetection}
                      onChange={(event) =>
                        updatePreferences({ openDiffAfterConflictCopy: event.target.checked })
                      }
                    />
                  </label>
                  <p className="setup-hint">
                    The diff view lets you compare conflicting versions side by side without
                    modifying either file.
                  </p>
                  <h3>Problem explanations</h3>
                  <label className="texlab-toggle">
                    <span>Explain common TeX errors in plain language</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={preferences.commonProblemHelp}
                      onChange={(event) =>
                        updatePreferences({ commonProblemHelp: event.target.checked })
                      }
                    />
                  </label>
                  <p className="setup-hint">
                    When TeXtra recognizes a common build error, Problems can show a short
                    explanation and a link to further help. This is on by default.
                  </p>
                </>
              )}
              {section === 'shortcuts' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <h3>Keyboard shortcuts</h3>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        updatePreferences({
                          keyboardShortcuts: {},
                        })
                      }
                      title="Reset all keyboard shortcuts to their default values"
                    >
                      <Undo2 size={13} /> Reset to defaults
                    </button>
                  </div>
                  <p className="setup-hint">
                    These shortcuts use Ctrl on Windows and Linux, and Command on macOS. You can
                    customize key combinations or add custom shortcuts.
                  </p>
                  <div
                    className="shortcuts-editor"
                    style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
                  >
                    {[
                      { id: 'save', label: 'Save', defaultKeys: 'Ctrl/Cmd + S' },
                      { id: 'saveCopy', label: 'Save a copy', defaultKeys: 'Ctrl/Cmd + Shift + S' },
                      {
                        id: 'compile',
                        label: 'Compile active document',
                        defaultKeys: 'Ctrl/Cmd + Enter',
                      },
                      {
                        id: 'commandPalette',
                        label: 'Command palette',
                        defaultKeys: 'Ctrl/Cmd + K',
                      },
                      { id: 'toggleSidebar', label: 'Toggle sidebar', defaultKeys: 'Ctrl/Cmd + B' },
                      {
                        id: 'togglePreview',
                        label: 'Preview / Output',
                        defaultKeys: 'Ctrl/Cmd + J',
                      },
                      {
                        id: 'find',
                        label: 'Find / replace',
                        defaultKeys: 'Ctrl/Cmd + F / Ctrl/Cmd + H',
                      },
                      {
                        id: 'switchModel',
                        label: 'Switch chat model',
                        defaultKeys: 'Ctrl/Cmd + /',
                      },
                      { id: 'inlineEdit', label: 'Inline AI edit', defaultKeys: 'Ctrl/Cmd + I' },
                      { id: 'escape', label: 'Close a menu or search', defaultKeys: 'Escape' },
                    ].map((shortcut) => {
                      const currentKey =
                        preferences.keyboardShortcuts?.[shortcut.id] ?? shortcut.defaultKeys;
                      return (
                        <div
                          key={shortcut.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 8px',
                            background: 'var(--surface)',
                            borderRadius: '6px',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <span
                            style={{ flex: 1, minWidth: 0, fontSize: '11px', color: 'var(--text)' }}
                          >
                            {shortcut.label}
                          </span>
                          <input
                            aria-label={`Shortcut keys for ${shortcut.label}`}
                            value={currentKey}
                            onChange={(e) => {
                              updatePreferences({
                                keyboardShortcuts: {
                                  ...preferences.keyboardShortcuts,
                                  [shortcut.id]: e.target.value,
                                },
                              });
                            }}
                            style={{
                              width: '180px',
                              padding: '4px 6px',
                              fontSize: '11px',
                              fontFamily: 'monospace',
                            }}
                          />
                          {preferences.keyboardShortcuts?.[shortcut.id] && (
                            <button
                              type="button"
                              className="icon-button small"
                              aria-label={`Reset ${shortcut.label} to default`}
                              title="Reset to default"
                              onClick={() => {
                                const next = { ...preferences.keyboardShortcuts };
                                delete next[shortcut.id];
                                updatePreferences({ keyboardShortcuts: next });
                              }}
                            >
                              <Undo2 size={13} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {Object.entries(preferences.keyboardShortcuts ?? {})
                      .filter(
                        ([key]) =>
                          ![
                            'save',
                            'saveCopy',
                            'compile',
                            'commandPalette',
                            'toggleSidebar',
                            'togglePreview',
                            'find',
                            'switchModel',
                            'inlineEdit',
                            'escape',
                          ].includes(key),
                      )
                      .map(([customId, customKey]) => (
                        <div
                          key={customId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 8px',
                            background: 'var(--surface)',
                            borderRadius: '6px',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <span
                            style={{ flex: 1, minWidth: 0, fontSize: '11px', color: 'var(--text)' }}
                          >
                            {customId}
                          </span>
                          <input
                            aria-label={`Shortcut keys for ${customId}`}
                            value={customKey}
                            onChange={(e) => {
                              updatePreferences({
                                keyboardShortcuts: {
                                  ...preferences.keyboardShortcuts,
                                  [customId]: e.target.value,
                                },
                              });
                            }}
                            style={{
                              width: '180px',
                              padding: '4px 6px',
                              fontSize: '11px',
                              fontFamily: 'monospace',
                            }}
                          />
                          <button
                            type="button"
                            className="icon-button small"
                            aria-label={`Remove shortcut ${customId}`}
                            title="Remove custom shortcut"
                            onClick={() => {
                              const next = { ...preferences.keyboardShortcuts };
                              delete next[customId];
                              updatePreferences({ keyboardShortcuts: next });
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                  </div>

                  <div
                    style={{
                      marginTop: '12px',
                      padding: '10px',
                      background: 'var(--surface)',
                      borderRadius: '6px',
                      border: '1px dashed var(--border)',
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'center',
                    }}
                  >
                    <input
                      aria-label="New shortcut action name"
                      placeholder="Action name (e.g. Export PDF)"
                      value={newShortcutLabel}
                      onChange={(e) => setNewShortcutLabel(e.target.value)}
                      style={{ flex: 1, minWidth: 0, padding: '4px 6px', fontSize: '11px' }}
                    />
                    <input
                      aria-label="New shortcut key combination"
                      placeholder="Keys (e.g. Ctrl/Cmd + E)"
                      value={newShortcutKeys}
                      onChange={(e) => setNewShortcutKeys(e.target.value)}
                      style={{
                        width: '150px',
                        padding: '4px 6px',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                      }}
                    />
                    <button
                      type="button"
                      className="text-button primary-button"
                      disabled={!newShortcutLabel.trim() || !newShortcutKeys.trim()}
                      onClick={() => {
                        updatePreferences({
                          keyboardShortcuts: {
                            ...preferences.keyboardShortcuts,
                            [newShortcutLabel.trim()]: newShortcutKeys.trim(),
                          },
                        });
                        setNewShortcutLabel('');
                        setNewShortcutKeys('');
                      }}
                    >
                      <Plus size={13} /> Add shortcut
                    </button>
                  </div>
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
                      for each listed rule.{' '}
                      <button
                        type="button"
                        onClick={() => void setupLink('chktexRules')}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: 'var(--accent)',
                          textDecoration: 'underline',
                          cursor: 'pointer',
                        }}
                      >
                        ChkTeX rule codes reference (official manual)
                      </button>
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
                  <div style={{ marginTop: '16px', marginBottom: '24px' }}>
                    <h4 style={{ margin: '14px 0 8px', fontSize: '13px', fontWeight: 600 }}>
                      Project build recipes
                    </h4>
                    <p className="setup-hint">
                      Customize compile tools and recipe steps for this project.
                    </p>
                    {useWorkspace.getState().project ? (
                      <CompileRecipeEditor
                        activePath={useWorkspace.getState().activePath}
                        config={useWorkspace.getState().projectConfig}
                        disabled={busy || build.running}
                        projectId={useWorkspace.getState().project!.id}
                        recipeName={useWorkspace.getState().engine}
                        onSelectRecipe={(recipeName) =>
                          useWorkspace.setState({ engine: recipeName as BuildEngine })
                        }
                        onSaved={(updatedConfig, savedRecipeName) => {
                          useWorkspace.setState((state) => ({
                            projectConfig: updatedConfig,
                            engine: savedRecipeName as BuildEngine,
                            recipes: state.activePath
                              ? { ...state.recipes, [state.activePath]: savedRecipeName }
                              : state.recipes,
                          }));
                        }}
                      />
                    ) : (
                      <p className="setup-hint">
                        Open a project folder to configure its build recipes.
                      </p>
                    )}
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
                  {!tools.some((tool) => tool.name === 'latexindent' && tool.path) && (
                    <div className="setup-actions">
                      <button onClick={() => void perform(() => setupLink('latexindent'))}>
                        Install latexindent
                      </button>
                    </div>
                  )}
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
          <SaveFooter
            state={saveState}
            error={preferenceError}
            onSave={async () => {
              // Fields that commit on blur have already blurred by the time the click lands.
              await preferencesSaved();
              return useUI.getState().saveState !== 'error';
            }}
            onClose={() => onOpenChange(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
