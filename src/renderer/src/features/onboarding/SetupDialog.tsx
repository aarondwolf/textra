import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AIChat,
  Article,
  CaretDown,
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
import { Button } from '../../components/Button';
import { SettingRow, StatusMessage } from '../../components/Layout';
import { SaveFooter } from '../save-status/SaveFooter';
import { aiSavesSettled, currentAISaveState, useAISaveState } from '../chat/useAISettings';
import { validateRecipeSettings } from '../../../../shared/recipes';
import {
  DEFAULT_SHORTCUTS,
  AVAILABLE_ADD_ACTIONS,
  formatShortcutFromEvent,
} from '../../../../shared/shortcuts';
import './setup.css';

const TexLabSettings = lazy(() =>
  import('./TexLabSettings').then((module) => ({ default: module.TexLabSettings })),
);
const AISettingsPanel = lazy(() =>
  import('../chat/AISettingsDialog').then((module) => ({ default: module.AISettingsPanel })),
);
const CompileRecipeEditor = lazy(() =>
  import('../compile/CompileRecipeEditor').then((module) => ({
    default: module.CompileRecipeEditor,
  })),
);
const RecipeDialog = lazy(() => import('./RecipeDialog'));

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

export const THEME_DEFAULTS: Record<
  string,
  {
    accent: string;
    accentStrong: string;
    accentBackground: string;
    background: string;
    surface: string;
    text: string;
  }
> = {
  dark: {
    accent: '#9bc9bb',
    accentStrong: '#b0ddcf',
    accentBackground: '#293e37',
    background: '#1c1e20',
    surface: '#222426',
    text: '#e4e5e2',
  },
  light: {
    accent: '#326958',
    accentStrong: '#245442',
    accentBackground: '#e1eee6',
    background: '#faf9f6',
    surface: '#f4f3ef',
    text: '#292f2c',
  },
  midnight: {
    accent: '#b2c8ff',
    accentStrong: '#d2ddff',
    accentBackground: '#29385e',
    background: '#141725',
    surface: '#1b2032',
    text: '#e8ebf5',
  },
  forest: {
    accent: '#a8d7a9',
    accentStrong: '#c8ecc9',
    accentBackground: '#2d4833',
    background: '#18221e',
    surface: '#202d26',
    text: '#e3ece4',
  },
  ocean: {
    accent: '#8ed3db',
    accentStrong: '#b9edf1',
    accentBackground: '#28505a',
    background: '#142329',
    surface: '#1b3038',
    text: '#e1eff1',
  },
  rose: {
    accent: '#efacc8',
    accentStrong: '#ffd0e1',
    accentBackground: '#60384f',
    background: '#261a23',
    surface: '#33212e',
    text: '#f1e4eb',
  },
  sand: {
    accent: '#9a6443',
    accentStrong: '#76482f',
    accentBackground: '#f0dcca',
    background: '#f5f0e4',
    surface: '#ede5d4',
    text: '#3b342a',
  },
};

interface ActionSelectMenuProps {
  selectedId: string;
  onSelect: (actionId: string) => void;
  availableActions: typeof AVAILABLE_ADD_ACTIONS;
}

function ActionSelectMenu({ selectedId, onSelect, availableActions }: ActionSelectMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const selectedAction = availableActions.find((a) => a.id === selectedId);
  const displayLabel = selectedAction ? selectedAction.label : 'Select Action';

  return (
    <div
      ref={containerRef}
      className="editor-format-heading"
      style={{
        flex: 1,
        minWidth: 0,
      }}
    >
      <button
        type="button"
        className="editor-format-heading-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Select Action"
        disabled={availableActions.length === 0}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {availableActions.length === 0 ? 'All actions have shortcuts' : displayLabel}
        </span>
        <CaretDown size={11} aria-hidden="true" style={{ flexShrink: 0, marginLeft: '6px' }} />
      </button>

      {open && (
        <div
          className="editor-format-heading-menu"
          role="menu"
          aria-label="Actions list"
          style={{
            top: 'auto',
            bottom: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            minWidth: '220px',
            maxHeight: '220px',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              padding: '4px 8px',
              fontSize: '9px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--faint)',
            }}
          >
            Select Action
          </div>
          {availableActions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onSelect(action.id);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontWeight: selectedId === action.id ? 600 : 400,
              }}
            >
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ShortcutCaptureBoxProps {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  recording?: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onRecord: (shortcut: string) => void;
}

function ShortcutCaptureBox({
  value,
  placeholder = 'Click to record keys…',
  ariaLabel,
  disabled = false,
  recording = false,
  onStartRecording,
  onStopRecording,
  onRecord,
}: ShortcutCaptureBoxProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (recording) {
      buttonRef.current?.focus();
    }
  }, [recording]);

  return (
    <button
      ref={buttonRef}
      type="button"
      data-shortcut-recorder="true"
      className={`shortcut-capture-box${recording ? ' is-recording' : ''}`}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled && !recording) {
          onStartRecording();
        }
      }}
      onBlur={() => {
        if (recording) {
          onStopRecording();
        }
      }}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
          onStopRecording();
          return;
        }
        const formatted = formatShortcutFromEvent(e);
        if (formatted) {
          onRecord(formatted);
        }
      }}
    >
      {recording ? 'Press keys…' : value || placeholder}
    </button>
  );
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
  const tools = useWorkspace((state) => state.tools);
  const buildRunning = useWorkspace((state) => state.build.running);
  const { preferences, updatePreferences, saveState, error: preferenceError } = useUI();
  const aiSaveState = useAISaveState();
  const combinedSaveState = [saveState, aiSaveState].includes('error')
    ? 'error'
    : [saveState, aiSaveState].includes('saving')
      ? 'saving'
      : [saveState, aiSaveState].includes('saved')
        ? 'saved'
        : 'idle';
  const [advancedRecipesOpen, setAdvancedRecipesOpen] = useState(false);
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
  const [newThemeAccentStrong, setNewThemeAccentStrong] = useState('#b0ddcf');
  const [newThemeAccentBg, setNewThemeAccentBg] = useState('#293e37');
  const [selectedActionId, setSelectedActionId] = useState('');
  const [recordingShortcutId, setRecordingShortcutId] = useState<string | null>(null);
  const projectConfig = useWorkspace((state) => state.projectConfig);
  const allAvailableRecipes = useMemo(() => {
    const list: Array<{ value: string; label: string }> = [...BUILD_RECIPES];
    if (projectConfig) {
      try {
        const validated = validateRecipeSettings(projectConfig);
        for (const recipe of validated['latex-workshop.latex.recipes']) {
          if (!list.some((item) => item.value === recipe.name)) {
            list.push({ value: recipe.name, label: recipe.name });
          }
        }
      } catch {
        /* ignore invalid project recipe config */
      }
    }
    return list;
  }, [projectConfig]);
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
                <Suspense fallback={<StatusMessage>Loading settings…</StatusMessage>}>
                  <AISettingsPanel
                    embedded
                    onClose={() => setSection('appearance')}
                    onOpenChange={(isOpen) => {
                      if (!isOpen) setSection('appearance');
                    }}
                  />
                </Suspense>
              )}
              {section === 'appearance' && (
                <>
                  <h3>Appearance</h3>
                  <label className="field-label">
                    Theme
                    <select
                      aria-label="Theme"
                      value={preferences.theme}
                      onChange={(event) => {
                        const newTheme = event.target.value as Theme;
                        const def = THEME_DEFAULTS[newTheme] ?? THEME_DEFAULTS.dark;
                        updatePreferences({
                          theme: newTheme,
                          themeCustomizations: {
                            accent: def.accent,
                            accentStrong: def.accentStrong,
                            accentBackground: def.accentBackground,
                            background: def.background,
                            surface: def.surface,
                            text: def.text,
                          },
                        });
                      }}
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
                      style={{
                        alignSelf: 'start',
                        marginTop: '4px',
                        color: 'var(--alert-error)',
                      }}
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

                  <h3>Theme colors</h3>
                  <p className="setup-hint">
                    Personalize the colors used by the selected color scheme. Your choices stay
                    local and are included in exported settings.
                  </p>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: '8px 12px',
                      marginTop: '6px',
                    }}
                  >
                    {(
                      [
                        ['accent', 'Accent'],
                        ['accentStrong', 'Strong accent'],
                        ['accentBackground', 'Accent background'],
                        ['background', 'Background'],
                        ['surface', 'Surface'],
                        ['text', 'Text'],
                      ] as const
                    ).map(([key, label]) => {
                      const curVal =
                        preferences.themeCustomizations[key] ??
                        (THEME_DEFAULTS[preferences.theme] ?? THEME_DEFAULTS.dark)[key];
                      return (
                        <label
                          key={key}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '11px',
                            color: 'var(--muted)',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            aria-label={label}
                            type="color"
                            className={`theme-color-input${key === 'surface' || key === 'background' ? ' has-border' : ''}`}
                            value={curVal}
                            onChange={(event) =>
                              updatePreferences({
                                themeCustomizations: {
                                  ...preferences.themeCustomizations,
                                  [key]: event.target.value,
                                },
                              })
                            }
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
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
                          onChange={(e) => {
                            const base = e.target.value as
                              'dark' | 'light' | 'midnight' | 'forest' | 'ocean' | 'rose' | 'sand';
                            const def = THEME_DEFAULTS[base] ?? THEME_DEFAULTS.dark;
                            setNewThemeBase(base);
                            setNewThemeBg(def.background);
                            setNewThemeSurface(def.surface);
                            setNewThemeText(def.text);
                            setNewThemeAccent(def.accent);
                            setNewThemeAccentStrong(def.accentStrong);
                            setNewThemeAccentBg(def.accentBackground);
                          }}
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
                          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                          gap: '8px',
                        }}
                      >
                        <label
                          className="field-label"
                          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          <input
                            type="color"
                            className="theme-color-input has-border"
                            aria-label="New theme background"
                            value={newThemeBg}
                            onChange={(e) => setNewThemeBg(e.target.value)}
                          />
                          <span>Background</span>
                        </label>
                        <label
                          className="field-label"
                          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          <input
                            type="color"
                            className="theme-color-input has-border"
                            aria-label="New theme surface"
                            value={newThemeSurface}
                            onChange={(e) => setNewThemeSurface(e.target.value)}
                          />
                          <span>Surface</span>
                        </label>
                        <label
                          className="field-label"
                          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          <input
                            type="color"
                            className="theme-color-input"
                            aria-label="New theme text"
                            value={newThemeText}
                            onChange={(e) => setNewThemeText(e.target.value)}
                          />
                          <span>Text</span>
                        </label>
                        <label
                          className="field-label"
                          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          <input
                            type="color"
                            className="theme-color-input"
                            aria-label="New theme accent"
                            value={newThemeAccent}
                            onChange={(e) => setNewThemeAccent(e.target.value)}
                          />
                          <span>Accent</span>
                        </label>
                        <label
                          className="field-label"
                          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          <input
                            type="color"
                            className="theme-color-input"
                            aria-label="New theme strong accent"
                            value={newThemeAccentStrong}
                            onChange={(e) => setNewThemeAccentStrong(e.target.value)}
                          />
                          <span>Strong accent</span>
                        </label>
                        <label
                          className="field-label"
                          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          <input
                            type="color"
                            className="theme-color-input"
                            aria-label="New theme accent background"
                            value={newThemeAccentBg}
                            onChange={(e) => setNewThemeAccentBg(e.target.value)}
                          />
                          <span>Accent bg</span>
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
                            accentStrong: newThemeAccentStrong,
                            accentBackground: newThemeAccentBg,
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
                  <h3>Automatic file history</h3>
                  <label className="texlab-toggle editor-session-toggle">
                    <span>Enable automatic file history</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={preferences.historyEnabled}
                      onChange={(event) =>
                        updatePreferences({ historyEnabled: event.target.checked })
                      }
                    />
                  </label>
                  {preferences.historyEnabled && (
                    <label className="chktex-field">
                      Snapshot interval (minutes)
                      <input
                        type="number"
                        min={1}
                        max={120}
                        step={1}
                        value={preferences.historyIntervalMinutes}
                        onChange={(event) => {
                          const val = Number.parseInt(event.target.value, 10);
                          if (Number.isFinite(val) && val >= 1 && val <= 120) {
                            updatePreferences({ historyIntervalMinutes: val });
                          }
                        }}
                      />
                    </label>
                  )}
                  <p className="setup-hint">
                    Store compressed backups of changed files in .textra/history. Automatic tiered
                    retention preserves all snapshots for 30 days, daily snapshots up to 90 days,
                    and weekly/monthly snapshots thereafter. Pinned snapshots are never pruned.
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
                      style={{
                        whiteSpace: 'nowrap',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      onClick={() => {
                        setRecordingShortcutId(null);
                        updatePreferences({
                          keyboardShortcuts: {},
                        });
                      }}
                      title="Reset all keyboard shortcuts to their default values"
                    >
                      <Undo2 size={13} /> Reset to defaults
                    </button>
                  </div>
                  <p className="setup-hint">
                    These shortcuts use Ctrl on Windows and Linux, and Command on macOS. Click the
                    edit icon or a shortcut box to record a new key combination.
                  </p>
                  <div
                    className="shortcuts-editor"
                    style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
                  >
                    {DEFAULT_SHORTCUTS.map((shortcut) => {
                      const currentKey =
                        preferences.keyboardShortcuts?.[shortcut.id] ?? shortcut.defaultKeys;
                      const isRecording = recordingShortcutId === shortcut.id;
                      const isOverridden = Boolean(preferences.keyboardShortcuts?.[shortcut.id]);
                      return (
                        <div key={shortcut.id} className="shortcut-row">
                          <span className="shortcut-row-label">{shortcut.label}</span>
                          <ShortcutCaptureBox
                            ariaLabel={`Shortcut keys for ${shortcut.label}`}
                            value={currentKey}
                            recording={isRecording}
                            onStartRecording={() => setRecordingShortcutId(shortcut.id)}
                            onStopRecording={() => {
                              if (recordingShortcutId === shortcut.id) {
                                setRecordingShortcutId(null);
                              }
                            }}
                            onRecord={(recordedKeys) => {
                              updatePreferences({
                                keyboardShortcuts: {
                                  ...preferences.keyboardShortcuts,
                                  [shortcut.id]: recordedKeys,
                                },
                              });
                              setRecordingShortcutId(null);
                            }}
                          />
                          <span className="tool-actions">
                            <button
                              type="button"
                              className="icon-button small"
                              aria-label={`Edit shortcut for ${shortcut.label}`}
                              title="Edit shortcut"
                              onClick={() => setRecordingShortcutId(shortcut.id)}
                            >
                              <Pencil size={13} />
                            </button>
                            {isOverridden && (
                              <button
                                type="button"
                                className="icon-button small"
                                aria-label={`Reset ${shortcut.label} to default`}
                                title="Reset to default"
                                onClick={() => {
                                  const next = { ...preferences.keyboardShortcuts };
                                  delete next[shortcut.id];
                                  updatePreferences({ keyboardShortcuts: next });
                                  if (recordingShortcutId === shortcut.id) {
                                    setRecordingShortcutId(null);
                                  }
                                }}
                              >
                                <Undo2 size={13} />
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                    {Object.entries(preferences.keyboardShortcuts ?? {})
                      .filter(([key]) => !DEFAULT_SHORTCUTS.some((d) => d.id === key))
                      .map(([customId, customKey]) => {
                        const knownAction = AVAILABLE_ADD_ACTIONS.find((a) => a.id === customId);
                        const label = knownAction ? knownAction.label : customId;
                        const isRecording = recordingShortcutId === customId;
                        return (
                          <div key={customId} className="shortcut-row">
                            <span className="shortcut-row-label">{label}</span>
                            <ShortcutCaptureBox
                              ariaLabel={`Shortcut keys for ${label}`}
                              value={customKey}
                              recording={isRecording}
                              onStartRecording={() => setRecordingShortcutId(customId)}
                              onStopRecording={() => {
                                if (recordingShortcutId === customId) {
                                  setRecordingShortcutId(null);
                                }
                              }}
                              onRecord={(recordedKeys) => {
                                updatePreferences({
                                  keyboardShortcuts: {
                                    ...preferences.keyboardShortcuts,
                                    [customId]: recordedKeys,
                                  },
                                });
                                setRecordingShortcutId(null);
                              }}
                            />
                            <span className="tool-actions">
                              <button
                                type="button"
                                className="icon-button small"
                                aria-label={`Edit shortcut for ${label}`}
                                title="Edit shortcut"
                                onClick={() => setRecordingShortcutId(customId)}
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                type="button"
                                className="icon-button small"
                                aria-label={`Remove shortcut ${label}`}
                                title="Remove shortcut"
                                onClick={() => {
                                  const next = { ...preferences.keyboardShortcuts };
                                  delete next[customId];
                                  updatePreferences({ keyboardShortcuts: next });
                                  if (recordingShortcutId === customId) {
                                    setRecordingShortcutId(null);
                                  }
                                }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  <div className="shortcut-add-card">
                    <span className="shortcut-add-title">Add a shortcut</span>
                    <div className="shortcut-add-controls">
                      <ActionSelectMenu
                        selectedId={selectedActionId}
                        availableActions={AVAILABLE_ADD_ACTIONS.filter(
                          (a) => !preferences.keyboardShortcuts?.[a.id],
                        )}
                        onSelect={(actionId) => {
                          setSelectedActionId(actionId);
                          setRecordingShortcutId('__add__');
                        }}
                      />
                      <ShortcutCaptureBox
                        ariaLabel="Record new shortcut key combination"
                        value=""
                        placeholder={
                          selectedActionId ? 'Click to record keys…' : 'Select an action first'
                        }
                        disabled={!selectedActionId}
                        recording={recordingShortcutId === '__add__' && Boolean(selectedActionId)}
                        onStartRecording={() => {
                          if (selectedActionId) {
                            setRecordingShortcutId('__add__');
                          }
                        }}
                        onStopRecording={() => {
                          if (recordingShortcutId === '__add__') {
                            setRecordingShortcutId(null);
                          }
                        }}
                        onRecord={(recordedKeys) => {
                          if (!selectedActionId) return;
                          updatePreferences({
                            keyboardShortcuts: {
                              ...preferences.keyboardShortcuts,
                              [selectedActionId]: recordedKeys,
                            },
                          });
                          setSelectedActionId('');
                          setRecordingShortcutId(null);
                        }}
                      />
                    </div>
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
                  <Suspense fallback={<StatusMessage>Loading settings…</StatusMessage>}>
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
                  </Suspense>
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
                        buildRunning ||
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
                  <SettingRow label="Default recipe for new documents">
                    <select
                      aria-label="Default recipe for new documents"
                      value={preferences.defaultRecipe}
                      onChange={(event) =>
                        updatePreferences({ defaultRecipe: event.target.value as BuildEngine })
                      }
                    >
                      {allAvailableRecipes.map((recipe) => (
                        <option key={recipe.value} value={recipe.value}>
                          {recipe.label}
                        </option>
                      ))}
                    </select>
                  </SettingRow>
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
                      <Suspense fallback={<StatusMessage>Loading settings…</StatusMessage>}>
                        <CompileRecipeEditor
                          activePath={useWorkspace.getState().activePath}
                          config={useWorkspace.getState().projectConfig}
                          disabled={busy || buildRunning}
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
                      </Suspense>
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
                  <Button
                    disabled={!useWorkspace.getState().project || busy || buildRunning}
                    onClick={() => setAdvancedRecipesOpen(true)}
                  >
                    Advanced project settings…
                  </Button>
                  {advancedRecipesOpen && (
                    <Suspense fallback={<StatusMessage>Loading settings…</StatusMessage>}>
                      <RecipeDialog
                        open={advancedRecipesOpen}
                        onOpenChange={setAdvancedRecipesOpen}
                      />
                    </Suspense>
                  )}
                  <h3>Generated files</h3>
                  <p className="setup-hint">
                    TeXtra keeps its default PDFs, logs, and auxiliary files in build/textra. Clean
                    this folder when you need a fresh compile. Custom output folders are never
                    removed automatically.
                  </p>
                  <div className="setup-actions">
                    <button
                      disabled={!useWorkspace.getState().project || busy || buildRunning}
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
              {message && <StatusMessage className="setup-message">{message}</StatusMessage>}

              {log && (
                <details>
                  <summary>Test compile output</summary>
                  <pre className="setup-log">{log}</pre>
                </details>
              )}
            </div>
          </div>
          <SaveFooter
            state={combinedSaveState}
            error={
              preferenceError ??
              (aiSaveState === 'error' ? 'An AI setting was not saved. Review AI Settings.' : null)
            }
            onSave={async () => {
              // Fields that commit on blur have already blurred by the time the click lands.
              await Promise.all([preferencesSaved(), aiSavesSettled()]);
              return useUI.getState().saveState !== 'error' && currentAISaveState() !== 'error';
            }}
            onClose={() => onOpenChange(false)}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
