import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Columns2, PanelLeft, Search } from 'lucide-react';
import { DEFAULT_PREFERENCES } from '../../shared/api';
import { hydratePreferences, useUI } from './state/ui';
import { Workspace } from './Workspace';
import SetupDialog from './features/onboarding/SetupDialog';
import RecipeDialog from './features/onboarding/RecipeDialog';
function CommandPalette() {
  const { preferences, updatePreferences, paletteOpen, setPaletteOpen } = useUI();
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const commands = [
    {
      label: 'Toggle sidebar',
      shortcut: 'Ctrl B',
      icon: PanelLeft,
      run: () => updatePreferences({ sidebarVisible: !preferences.sidebarVisible }),
    },
    {
      label: 'Toggle preview pane',
      shortcut: '',
      icon: Columns2,
      run: () => updatePreferences({ previewVisible: !preferences.previewVisible }),
    },
    {
      label: 'Reset layout',
      shortcut: '',
      icon: Columns2,
      run: () =>
        updatePreferences({
          sidebarVisible: DEFAULT_PREFERENCES.sidebarVisible,
          previewVisible: DEFAULT_PREFERENCES.previewVisible,
          editorWidth: DEFAULT_PREFERENCES.editorWidth,
        }),
    },
  ].filter((command) => command.label.toLowerCase().includes(query.toLowerCase().trim()));

  function runCommand(run: () => void) {
    run();
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
                if (event.key === 'Enter' && commands[0]) runCommand(commands[0].run);
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
            <div className="eyebrow command-group">WORKSPACE</div>
            {commands.map(({ label, shortcut, icon: Icon, run }) => (
              <button
                className="command-item"
                aria-label={label}
                key={label}
                onClick={() => runCommand(run)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
                {shortcut && <kbd>{shortcut}</kbd>}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            ))}
            {commands.length === 0 && <p className="no-commands">No commands match “{query}”.</p>}
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
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);
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
      <SetupDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <RecipeDialog open={recipeEditorOpen} onOpenChange={setRecipeEditorOpen} />
    </div>
  );
}
