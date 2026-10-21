import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  Columns2,
  FilePdf,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Hammer,
  LocateFixed,
  Palette,
  PanelLeft,
  Pencil,
  Play,
  Save,
  Scroll,
  Search,
  Settings,
  Trash2,
} from './icons';
import { DEFAULT_PREFERENCES, type Theme } from '../../shared/api';
import { hydratePreferences, useUI } from './state/ui';
import { Workspace } from './Workspace';
import SetupDialog from './features/onboarding/SetupDialog';
import RecipeDialog from './features/onboarding/RecipeDialog';
import { ToastViewport } from './features/notifications/ToastViewport';

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
    setRecipeEditorOpen,
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
      run: () => window.dispatchEvent(new Event('textra:compile')),
    },
    {
      label: 'Save current file',
      shortcut: 'Ctrl S',
      icon: Save,
      run: () => window.dispatchEvent(new Event('textra:save-active')),
    },
    {
      label: 'Save all open files',
      shortcut: '',
      icon: Save,
      run: () => window.dispatchEvent(new Event('textra:save-all')),
    },
    {
      label: 'Open project folder',
      shortcut: 'Ctrl O',
      icon: FolderOpen,
      run: () => window.dispatchEvent(new Event('textra:open-folder')),
    },
    {
      label: 'New file',
      shortcut: '',
      icon: FilePlus2,
      run: () => window.dispatchEvent(new Event('textra:new-file')),
    },
    {
      label: 'New folder',
      shortcut: '',
      icon: FolderPlus,
      run: () => window.dispatchEvent(new Event('textra:new-folder')),
    },
    {
      label: 'Find in PDF preview',
      shortcut: 'Ctrl F',
      icon: FilePdf,
      run: () => window.dispatchEvent(new Event('textra:find-pdf')),
    },
    {
      label: 'Find and replace in editor',
      shortcut: 'Ctrl H',
      icon: Search,
      run: () => window.dispatchEvent(new Event('textra:replace-source')),
    },
    {
      label: 'Go to line',
      shortcut: 'Ctrl G',
      icon: LocateFixed,
      run: () => window.dispatchEvent(new Event('textra:goto-line')),
    },
    {
      label: 'Format document with latexindent',
      shortcut: '',
      icon: Pencil,
      run: () => window.dispatchEvent(new Event('textra:format-document')),
    },
    {
      label: 'Clean generated build files',
      shortcut: '',
      icon: Trash2,
      run: () => window.dispatchEvent(new Event('textra:clean-artifacts')),
    },
    {
      label: 'Toggle word wrap',
      shortcut: '',
      icon: Scroll,
      run: () => window.dispatchEvent(new Event('textra:toggle-wrap')),
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
      run: () => setRecipeEditorOpen(true),
    },
    {
      label: 'Open settings',
      shortcut: '',
      icon: Settings,
      run: () => window.dispatchEvent(new Event('textra:open-settings')),
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
    ...(['light', 'midnight', 'forest', 'ocean', 'rose', 'sand'] as Theme[]).map((theme) => ({
      label: `Switch theme: ${theme.charAt(0).toUpperCase() + theme.slice(1)}`,
      shortcut: '',
      icon: Palette,
      run: () => updatePreferences({ theme }),
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
            Search workspace commands. Use Tab to choose a command, then Enter to run it.
          </Dialog.Description>
          <div className="command-search">
            <Search size={19} aria-hidden="true" />
            <input
              ref={input}
              aria-label="Search commands"
              placeholder="What would you like to do?"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && commands[0])
                  runCommand(commands[0].label, commands[0].run);
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  document.querySelector<HTMLButtonElement>('.command-item')?.focus();
                }
              }}
            />
            <Dialog.Close className="key-cap" aria-label="Close command palette">
              Esc
            </Dialog.Close>
          </div>
          <div
            className="command-list"
            aria-label="Workspace commands"
            onKeyDown={(event) => {
              const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                buttons[(index + 1) % buttons.length]?.focus();
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (index <= 0) input.current?.focus();
                else buttons[index - 1]?.focus();
              }
            }}
          >
            {recentCommands.length > 0 && <div className="eyebrow command-group">RECENT</div>}
            {recentCommands.map(({ label, shortcut, icon: Icon, run }) => (
              <button
                className="command-item"
                aria-label={label}
                key={label}
                onClick={() => runCommand(label, run)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
                {shortcut && <kbd>{shortcut}</kbd>}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            ))}
            {otherCommands.length > 0 && <div className="eyebrow command-group">WORKSPACE</div>}
            {otherCommands.map(({ label, shortcut, icon: Icon, run }) => (
              <button
                className="command-item"
                aria-label={label}
                key={label}
                onClick={() => runCommand(label, run)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
                {shortcut && <kbd>{shortcut}</kbd>}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            ))}
            {commands.length === 0 && <p className="no-commands">No commands match “{query}”.</p>}
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
          </div>
          <div className="command-footer">
            Your workspace, a few keystrokes away.
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> navigate <kbd>↵</kbd> select
            </span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { preferences, hydrated, error, updatePreferences, setPaletteOpen } = useUI();
  const { recipeEditorOpen, setRecipeEditorOpen } = useUI();
  useEffect(() => {
    void hydratePreferences();
  }, []);
  useEffect(() => {
    const handleOpenSettings = () => setSettingsOpen(true);
    window.addEventListener('textra:open-settings', handleOpenSettings);
    return () => window.removeEventListener('textra:open-settings', handleOpenSettings);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preferences.theme;
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
      if (value === defaultValue) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
  }, [preferences.theme, preferences.themeCustomizations]);
  useEffect(() => {
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !hydrated) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setPaletteOpen(!useUI.getState().paletteOpen);
      }
      if (key === 'b') {
        event.preventDefault();
        updatePreferences({ sidebarVisible: !useUI.getState().preferences.sidebarVisible });
      }
      if (key === 'j') {
        event.preventDefault();
        updatePreferences({ previewVisible: true });
        useUI.getState().setPanel(useUI.getState().panel === 'output' ? 'preview' : 'output');
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hydrated, setPaletteOpen, updatePreferences]);
  return (
    <div className="app-shell">
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <Workspace onOpenSettings={() => setSettingsOpen(true)} />
      <CommandPalette />
      <ToastViewport />
      <SetupDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <RecipeDialog open={recipeEditorOpen} onOpenChange={setRecipeEditorOpen} />
    </div>
  );
}
