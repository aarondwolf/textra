import { emitTextraEvent } from './services/events';
import { useEffect, useRef, useState } from 'react';
import { lazyFeature } from './features/startup/LazyFeature';
import { LayeredDialog as Dialog } from './components/overlay-layers';
import { Command } from 'cmdk';
import {
  AIChat,
  ArrowRight,
  Article,
  Columns2,
  FilePdf,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Hammer,
  History,
  LocateFixed,
  Palette,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Play,
  Plus,
  Save,
  Scroll,
  Search,
  Settings,
  TextraLogo,
  Trash2,
} from './icons';
import { DEFAULT_PREFERENCES } from '../../shared/api';
import { DEFAULT_SHORTCUTS, matchesShortcut } from '../../shared/shortcuts';
import { hydratePreferences, useUI } from './state/ui';
import { THEME_DEFAULTS, themeSelection } from './state/themes';
import { useStartup } from './state/startup';
import { useWorkspace } from './state/workspace';
import { scheduleBackground } from './features/startup/scheduling';
import { Workspace } from './Workspace';
import type { SectionId } from './features/onboarding/SetupDialog';
import { ToastViewport } from './features/notifications/ToastViewport';
import { installShutdown, useShutdown } from './state/shutdown';
import { AppTooltip } from './components/HelpTooltip';
import { WindowControls } from './components/WindowControls';

const SetupDialog = lazyFeature(() => import('./features/onboarding/SetupDialog'), 'Settings');

const SHORTCUT_REFERENCE = [
  ['Command palette', 'Ctrl/Cmd K'],
  ['Compile active document', 'Ctrl/Cmd Enter'],
  ['Save current file', 'Ctrl/Cmd S'],
  ['Save file as', 'Shift Ctrl/Cmd S'],
  ['Open folder', 'Ctrl/Cmd O'],
  ['Toggle sidebar', 'Ctrl/Cmd B'],
  ['Toggle preview/output', 'Ctrl/Cmd J'],
  ['Find in editor or preview', 'Ctrl/Cmd F'],
  ['Find and replace in editor', 'Ctrl/Cmd H'],
  ['Go to line', 'Ctrl/Cmd G'],
] as const;

function CommandPalette() {
  const {
    preferences,
    updatePreferences,
    paletteOpen,
    setPaletteOpen,
    expandedPane,
    setExpandedPane,
  } = useUI();
  const [query, setQuery] = useState('');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const allCommands = [
    {
      label: 'Compile active document',
      shortcut: 'Ctrl Enter',
      icon: Play,
      run: () => emitTextraEvent('textra:compile'),
    },
    {
      label: 'Save current file',
      shortcut: 'Ctrl S',
      icon: Save,
      run: () => emitTextraEvent('textra:save-active'),
    },
    {
      label: 'Save all open files',
      shortcut: '',
      icon: Save,
      run: () => emitTextraEvent('textra:save-all'),
    },
    {
      label: 'Open project folder',
      shortcut: 'Ctrl O',
      icon: FolderOpen,
      run: () => emitTextraEvent('textra:open-folder'),
    },
    {
      label: 'New file',
      shortcut: '',
      icon: FilePlus2,
      run: () => emitTextraEvent('textra:new-file'),
    },
    {
      label: 'New folder',
      shortcut: '',
      icon: FolderPlus,
      run: () => emitTextraEvent('textra:new-folder'),
    },
    {
      label: 'Find in PDF preview',
      shortcut: 'Ctrl F',
      icon: FilePdf,
      run: () => emitTextraEvent('textra:find-pdf'),
    },
    {
      label: 'Find and replace in editor',
      shortcut: 'Ctrl H',
      icon: Search,
      run: () => emitTextraEvent('textra:replace-source'),
    },
    {
      label: 'Go to line',
      shortcut: 'Ctrl G',
      icon: LocateFixed,
      run: () => emitTextraEvent('textra:goto-line'),
    },
    {
      label: 'Format document with latexindent',
      shortcut: '',
      icon: Pencil,
      run: () => emitTextraEvent('textra:format-document'),
    },
    {
      label: 'Clean generated build files',
      shortcut: '',
      icon: Trash2,
      run: () => emitTextraEvent('textra:clean-artifacts'),
    },
    {
      label: 'Toggle word wrap',
      shortcut: '',
      icon: Scroll,
      run: () => emitTextraEvent('textra:toggle-wrap'),
    },
    {
      label: 'Toggle formatting toolbar',
      shortcut: '',
      icon: Pencil,
      run: () => updatePreferences({ formatToolbarVisible: !preferences.formatToolbarVisible }),
    },
    {
      label: 'Manage compile recipes',
      shortcut: '',
      icon: Hammer,
      run: () =>
        window.dispatchEvent(
          new CustomEvent('textra:open-settings', { detail: { section: 'compilation' } }),
        ),
    },
    {
      label: 'AI settings',
      shortcut: '',
      icon: AIChat,
      run: () =>
        window.dispatchEvent(
          new CustomEvent('textra:open-settings', { detail: { section: 'ai' } }),
        ),
    },
    {
      label: 'Configure keyboard shortcuts',
      shortcut: '',
      icon: Article,
      run: () => emitTextraEvent('textra:open-settings', { section: 'shortcuts' }),
    },
    {
      label: 'Open settings',
      shortcut: '',
      icon: Settings,
      run: () => emitTextraEvent('textra:open-settings'),
    },
    {
      label: 'Open application data folder (AppData)',
      shortcut: '',
      icon: FolderOpen,
      run: () => {
        void window.textra.openUserDataFolder();
      },
    },
    {
      label: 'View file history',
      shortcut: '',
      icon: History,
      run: () => emitTextraEvent('textra:view-history'),
    },
    {
      label: 'Create history snapshot',
      shortcut: '',
      icon: Plus,
      run: () => emitTextraEvent('textra:create-snapshot'),
    },
    {
      label: 'Toggle sidebar',
      shortcut: 'Ctrl B',
      icon: PanelLeft,
      run: () => updatePreferences({ sidebarVisible: !preferences.sidebarVisible }),
    },
    {
      label: 'Toggle preview pane',
      shortcut: 'Ctrl J',
      icon: Columns2,
      run: () => updatePreferences({ previewVisible: !preferences.previewVisible }),
    },
    {
      label: 'Toggle full-width preview',
      shortcut: '',
      icon: Columns2,
      run: () => {
        if (!preferences.previewVisible) updatePreferences({ previewVisible: true });
        setExpandedPane(
          preferences.previewVisible && expandedPane === 'preview' ? null : 'preview',
        );
      },
    },
    {
      label: 'Toggle full-width editor',
      shortcut: '',
      icon: Columns2,
      run: () => {
        if (!preferences.previewVisible) updatePreferences({ previewVisible: true });
        setExpandedPane(preferences.previewVisible && expandedPane === 'editor' ? null : 'editor');
      },
    },
    {
      label: 'Reset layout',
      shortcut: '',
      icon: Columns2,
      run: () => {
        setExpandedPane(null);
        updatePreferences({
          sidebarVisible: DEFAULT_PREFERENCES.sidebarVisible,
          previewVisible: DEFAULT_PREFERENCES.previewVisible,
          editorWidth: DEFAULT_PREFERENCES.editorWidth,
        });
      },
    },
    ...[
      ...Object.keys(THEME_DEFAULTS),
      ...(preferences.customThemes ?? []).map((theme) => theme.id),
    ].map((theme) => ({
      label: `Switch theme: ${preferences.customThemes?.find((custom) => custom.id === theme)?.name ?? theme.charAt(0).toUpperCase() + theme.slice(1)}`,
      shortcut: '',
      icon: Palette,
      run: () => updatePreferences(themeSelection(theme, preferences.customThemes)),
    })),
  ];
  const search = query.toLowerCase().trim();
  const commands = [...allCommands]
    .filter(
      (command) =>
        command.label.toLowerCase().includes(search) ||
        command.shortcut.toLowerCase().includes(search),
    )
    .sort((left, right) => {
      const leftRecent = preferences.recentCommands.indexOf(left.label);
      const rightRecent = preferences.recentCommands.indexOf(right.label);
      const leftIndex = leftRecent < 0 ? Number.MAX_SAFE_INTEGER : leftRecent;
      const rightIndex = rightRecent < 0 ? Number.MAX_SAFE_INTEGER : rightRecent;
      return leftIndex - rightIndex;
    });
  const recentCommands = commands.filter((command) =>
    preferences.recentCommands.includes(command.label),
  );
  const otherCommands = commands.filter(
    (command) => !preferences.recentCommands.includes(command.label),
  );
  const matchingShortcuts = SHORTCUT_REFERENCE.filter(
    ([label, shortcut]) =>
      label.toLowerCase().includes(search) || shortcut.toLowerCase().includes(search),
  );

  function runCommand(label: string, run: () => void) {
    run();
    updatePreferences({
      recentCommands: [
        label,
        ...preferences.recentCommands.filter((entry) => entry !== label),
      ].slice(0, 12),
    });
    setPaletteOpen(false);
  }

  return (
    <Dialog.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="command-dialog"
          onOpenAutoFocus={() => {
            opener.current = document.activeElement as HTMLElement | null;
            setQuery('');
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search workspace commands. Use arrow keys to choose a command, then Enter to run it.
          </Dialog.Description>
          <Command className="command-palette" shouldFilter={false} loop>
            <div className="command-search">
              <Search size={19} aria-hidden="true" />
              <Command.Input
                ref={input}
                aria-label="Search commands"
                placeholder="What would you like to do?"
                value={query}
                onValueChange={setQuery}
              />
              <Dialog.Close className="key-cap" aria-label="Close command palette">
                Esc
              </Dialog.Close>
            </div>
            <Command.List className="command-list" aria-label="Workspace commands">
              {recentCommands.length > 0 && (
                <Command.Group heading="RECENT">
                  <div className="eyebrow command-group">RECENT</div>
                  {recentCommands.map(({ label, shortcut, icon: Icon, run }) => (
                    <Command.Item
                      key={label}
                      value={label}
                      className="command-item"
                      aria-label={label}
                      onSelect={() => runCommand(label, run)}
                    >
                      <Icon size={17} aria-hidden="true" />
                      <span>{label}</span>
                      {shortcut && <kbd>{shortcut}</kbd>}
                      <ArrowRight size={15} aria-hidden="true" />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {otherCommands.length > 0 && (
                <Command.Group heading="WORKSPACE">
                  <div className="eyebrow command-group">WORKSPACE</div>
                  {otherCommands.map(({ label, shortcut, icon: Icon, run }) => (
                    <Command.Item
                      key={label}
                      value={label}
                      className="command-item"
                      aria-label={label}
                      onSelect={() => runCommand(label, run)}
                    >
                      <Icon size={17} aria-hidden="true" />
                      <span>{label}</span>
                      {shortcut && <kbd>{shortcut}</kbd>}
                      <ArrowRight size={15} aria-hidden="true" />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {commands.length === 0 && (
                <Command.Empty className="no-commands">No commands match “{query}”.</Command.Empty>
              )}
              <details
                className="command-shortcuts"
                open={shortcutsOpen || search.length > 0}
                onToggle={(event) => setShortcutsOpen(event.currentTarget.open)}
              >
                <summary>Keyboard shortcuts</summary>
                {matchingShortcuts.map(([label, shortcut]) => (
                  <p key={label}>
                    <span>{label}</span> <kbd>{shortcut}</kbd>
                  </p>
                ))}
                {matchingShortcuts.length === 0 && <p>No shortcuts match “{query}”.</p>}
              </details>
            </Command.List>
            <div className="command-footer">
              Your workspace, a few keystrokes away.
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> navigate <kbd>↵</kbd> select
              </span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function isLightColor(color: string): boolean {
  const hex = color.trim().replace(/^#/, '');
  if (hex.length !== 3 && hex.length !== 6) return false;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

export function App() {
  const closing = useShutdown((state) => state.pending);
  useEffect(() => installShutdown(), []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SectionId | undefined>(undefined);
  const { preferences, hydrated, error, updatePreferences } = useUI();
  const editorReady = useStartup((state) => state.editorReady);
  const restoration = useStartup((state) => state.restoration);
  const activePath = useWorkspace((state) => state.activePath);
  const coreReady = editorReady || (hydrated && restoration === 'settled' && !activePath);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [appVersion, setAppVersion] = useState<string>('0.2.0');

  useEffect(() => {
    if (!coreReady) return;
    let cancelled = false;
    let cancelPanels = () => {};
    const cancel = scheduleBackground(() => {
      void SetupDialog.preload()
        .then(() => import('./features/onboarding/SetupDialog'))
        .then((module) => {
          if (!cancelled) cancelPanels = module.preloadSettingsPanels();
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      cancel();
      cancelPanels();
    };
  }, [coreReady]);

  useEffect(() => {
    void window.textra
      ?.getAppInfo()
      .then((res) => {
        if (res?.ok && res.value?.version) {
          setAppVersion(res.value.version);
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (settingsOpen) setSettingsLoaded(true);
  }, [settingsOpen]);
  useEffect(() => {
    void hydratePreferences();
  }, []);
  useEffect(() => {
    const handleOpenSettings = (event?: Event) => {
      const section = (event as CustomEvent<{ section?: SectionId }> | undefined)?.detail?.section;
      if (section) setSettingsSection(section);
      setSettingsOpen(true);
    };
    window.addEventListener('textra:open-settings', handleOpenSettings);
    return () => window.removeEventListener('textra:open-settings', handleOpenSettings);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const customThemes = preferences.customThemes ?? [];
    const activeCustom = customThemes.find((t) => t.id === preferences.theme);

    if (activeCustom) {
      root.dataset.theme = activeCustom.baseTheme;
      if (activeCustom.background) root.style.setProperty('--bg', activeCustom.background);
      if (activeCustom.surface) root.style.setProperty('--surface', activeCustom.surface);
      if (activeCustom.text) root.style.setProperty('--text', activeCustom.text);
      if (activeCustom.accent) root.style.setProperty('--accent', activeCustom.accent);
      if (activeCustom.accentStrong)
        root.style.setProperty('--accent-strong', activeCustom.accentStrong);
      if (activeCustom.accentBackground)
        root.style.setProperty('--accent-bg', activeCustom.accentBackground);
    } else {
      root.dataset.theme = preferences.theme;
      for (const varName of [
        '--bg',
        '--surface',
        '--raised',
        '--sidebar',
        '--preview',
        '--border',
        '--text',
        '--muted',
        '--hover',
      ]) {
        root.style.removeProperty(varName);
      }
    }

    const custom = preferences.themeCustomizations;
    const defaults = DEFAULT_PREFERENCES.themeCustomizations;
    for (const [name, value] of [
      ['--accent', custom.accent],
      ['--accent-strong', custom.accentStrong],
      ['--accent-bg', custom.accentBackground],
    ] as const) {
      const defaultValue =
        name === '--accent'
          ? defaults.accent
          : name === '--accent-strong'
            ? defaults.accentStrong
            : defaults.accentBackground;
      if (value === defaultValue && !activeCustom?.accent) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
    if (custom.background) root.style.setProperty('--bg', custom.background);
    if (custom.surface) root.style.setProperty('--surface', custom.surface);
    if (custom.text) root.style.setProperty('--text', custom.text);

    const effectiveBg =
      custom.surface || custom.background || activeCustom?.surface || activeCustom?.background;
    if (effectiveBg) {
      const isLight = isLightColor(effectiveBg);
      root.style.setProperty('--logo-dark-accent', isLight ? '#1c1e20' : '#9bc9bb');
      root.style.setProperty('--logo-light-accent', isLight ? '#293e37' : '#ffffff');
    } else {
      root.style.removeProperty('--logo-dark-accent');
      root.style.removeProperty('--logo-light-accent');
    }

    const uiFont = preferences.uiFont || activeCustom?.uiFont;
    if (uiFont) {
      root.style.setProperty('--font-ui', uiFont);
    } else {
      root.style.removeProperty('--font-ui');
    }

    const editorFont = preferences.editorFont || activeCustom?.editorFont;
    if (editorFont) {
      root.style.setProperty('--font-mono', editorFont);
    } else {
      root.style.removeProperty('--font-mono');
    }
  }, [
    preferences.theme,
    preferences.themeCustomizations,
    preferences.customThemes,
    preferences.uiFont,
    preferences.editorFont,
  ]);
  function executeShortcutAction(id: string) {
    const ui = useUI.getState();
    switch (id) {
      case 'save':
        emitTextraEvent('textra:save-active');
        break;
      case 'saveCopy':
        emitTextraEvent('textra:save-copy');
        break;
      case 'saveAll':
        emitTextraEvent('textra:save-all');
        break;
      case 'compile':
        emitTextraEvent('textra:compile');
        break;
      case 'commandPalette':
        ui.setPaletteOpen(!ui.paletteOpen);
        break;
      case 'toggleSidebar':
        ui.updatePreferences({ sidebarVisible: !ui.preferences.sidebarVisible });
        break;
      case 'togglePreview':
        ui.updatePreferences({ previewVisible: true });
        ui.setPanel(ui.panel === 'output' ? 'preview' : 'output');
        break;
      case 'find':
      case 'findPdf':
        emitTextraEvent('textra:find-pdf');
        break;
      case 'replace':
        emitTextraEvent('textra:replace-source');
        break;
      case 'gotoLine':
        emitTextraEvent('textra:goto-line');
        break;
      case 'formatDocument':
        emitTextraEvent('textra:format-document');
        break;
      case 'cleanArtifacts':
        emitTextraEvent('textra:clean-artifacts');
        break;
      case 'cleanAux':
        emitTextraEvent('textra:clean-aux');
        break;
      case 'openFolder':
        emitTextraEvent('textra:open-folder');
        break;
      case 'newFile':
        emitTextraEvent('textra:new-file');
        break;
      case 'newFolder':
        emitTextraEvent('textra:new-folder');
        break;
      case 'toggleWrap':
        emitTextraEvent('textra:toggle-wrap');
        break;
      case 'toggleFormatToolbar':
        ui.updatePreferences({ formatToolbarVisible: !ui.preferences.formatToolbarVisible });
        break;
      case 'switchModel':
        emitTextraEvent('textra:switch-model');
        break;
      case 'inlineEdit':
        emitTextraEvent('textra:inline-edit');
        break;
      case 'openSettings':
        emitTextraEvent('textra:open-settings');
        break;
      case 'openAiSettings':
        emitTextraEvent('textra:open-settings', { section: 'ai' });
        break;
      case 'escape':
        if (ui.paletteOpen) ui.setPaletteOpen(false);
        break;
      default:
        emitTextraEvent('textra:custom-shortcut', { action: id });
        break;
    }
  }

  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || !hydrated) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-shortcut-recorder]')) return;

      const activeShortcuts = useUI.getState().preferences.keyboardShortcuts ?? {};

      // Check overrides and custom added shortcuts first
      for (const [actionId, pattern] of Object.entries(activeShortcuts)) {
        if (pattern && matchesShortcut(event, pattern)) {
          const target = event.target instanceof Element ? event.target : null;
          const isInput = target?.closest('input, textarea, [data-inline-edit]');
          if (isInput && !event.ctrlKey && !event.metaKey && !event.altKey) {
            continue;
          }
          event.preventDefault();
          executeShortcutAction(actionId);
          return;
        }
      }

      // Check default shortcuts that have not been overridden
      for (const def of DEFAULT_SHORTCUTS) {
        if (activeShortcuts[def.id] !== undefined) continue;
        if (def.defaultKeys && matchesShortcut(event, def.defaultKeys)) {
          const target = event.target instanceof Element ? event.target : null;
          const isInput = target?.closest('input, textarea, [data-inline-edit]');
          if (isInput && !event.ctrlKey && !event.metaKey && !event.altKey) {
            continue;
          }
          event.preventDefault();
          executeShortcutAction(def.id);
          return;
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hydrated]);
  return (
    <>
      {closing && (
        <div className="error-banner" role="status">
          Saving session before closing…
        </div>
      )}
      <div className="app-shell" inert={closing}>
        <header className="window-titlebar" aria-label="Application title bar">
          <div className="window-titlebar-brand">
            <TextraLogo size={18} />
            <span>TeXtra</span>
            <span className="window-titlebar-version">
              {appVersion.startsWith('v') ? appVersion : `v${appVersion}`}
            </span>
          </div>
          <button
            type="button"
            className="window-titlebar-search"
            onClick={() => useUI.getState().setPaletteOpen(true)}
            aria-label="Search commands and files (Ctrl+K)"
          >
            <Search size={12} aria-hidden="true" />
            <span className="window-titlebar-search-text">Search commands, files...</span>
            <kbd className="window-titlebar-search-kbd">Ctrl K</kbd>
          </button>
          <div className="window-titlebar-actions">
            <AppTooltip
              content={
                preferences.sidebarVisible ? 'Collapse sidebar (Ctrl+B)' : 'Expand sidebar (Ctrl+B)'
              }
            >
              <button
                type="button"
                className={`window-titlebar-action ${preferences.sidebarVisible ? 'active' : ''}`}
                aria-label="Toggle sidebar"
                aria-pressed={preferences.sidebarVisible}
                onClick={() => updatePreferences({ sidebarVisible: !preferences.sidebarVisible })}
              >
                {preferences.sidebarVisible ? (
                  <PanelLeftClose size={15} />
                ) : (
                  <PanelLeftOpen size={15} />
                )}
              </button>
            </AppTooltip>
            <AppTooltip
              content={
                preferences.previewVisible ? 'Collapse preview (Ctrl+J)' : 'Expand preview (Ctrl+J)'
              }
            >
              <button
                type="button"
                className={`window-titlebar-action ${preferences.previewVisible ? 'active' : ''}`}
                aria-label="Toggle preview"
                aria-pressed={preferences.previewVisible}
                onClick={() => updatePreferences({ previewVisible: !preferences.previewVisible })}
              >
                {preferences.previewVisible ? (
                  <PanelRightClose size={15} />
                ) : (
                  <PanelRightOpen size={15} />
                )}
              </button>
            </AppTooltip>
          </div>
          <WindowControls />
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        <Workspace
          onOpenSettings={(section) => {
            if (section) setSettingsSection(section);
            setSettingsOpen(true);
          }}
        />
        <CommandPalette />
        <ToastViewport />
        {(settingsOpen || settingsLoaded) && (
          <SetupDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            initialSection={settingsSection}
          />
        )}
      </div>
    </>
  );
}
