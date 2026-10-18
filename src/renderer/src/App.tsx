import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Columns2,
  FileText,
  FolderOpen,
  Keyboard,
  Moon,
  PanelBottom,
  PanelLeft,
  Search,
  Sun,
  Terminal,
  X,
} from 'lucide-react';
import { DEFAULT_PREFERENCES, PRODUCT_NAME } from '../../shared/api';
import { hydratePreferences, useUI } from './state/ui';

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
      label: 'Toggle bottom panel',
      shortcut: 'Ctrl J',
      icon: PanelBottom,
      run: () => updatePreferences({ outputVisible: !preferences.outputVisible }),
    },
    {
      label: `Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} theme`,
      shortcut: '',
      icon: preferences.theme === 'dark' ? Sun : Moon,
      run: () => updatePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' }),
    },
    {
      label: 'Reset layout',
      shortcut: '',
      icon: Columns2,
      run: () =>
        updatePreferences({
          sidebarVisible: DEFAULT_PREFERENCES.sidebarVisible,
          outputVisible: DEFAULT_PREFERENCES.outputVisible,
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

function SplitHandle({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  const { preferences, updatePreferences } = useUI();
  const dragging = useRef(false);
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = container.current?.getBoundingClientRect();
    if (!bounds) return;
    updatePreferences({
      editorWidth: Math.min(
        75,
        Math.max(30, Math.round(((event.clientX - bounds.left) / bounds.width) * 100)),
      ),
    });
  };
  const keyboardResize = (event: KeyboardEvent<HTMLDivElement>) => {
    const values: Record<string, number> = {
      ArrowLeft: preferences.editorWidth - 2,
      ArrowRight: preferences.editorWidth + 2,
      Home: 30,
      End: 75,
    };
    if (event.key in values) {
      event.preventDefault();
      updatePreferences({ editorWidth: Math.min(75, Math.max(30, values[event.key])) });
    }
  };
  return (
    <div
      className="split-handle"
      role="separator"
      aria-label="Editor and preview split"
      aria-orientation="vertical"
      aria-valuemin={30}
      aria-valuemax={75}
      aria-valuenow={preferences.editorWidth}
      tabIndex={0}
      onKeyDown={keyboardResize}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        resize(event);
      }}
      onPointerMove={(event) => {
        if (dragging.current) resize(event);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        dragging.current = false;
      }}
    >
      <span />
    </div>
  );
}

function BottomPanel() {
  const { panel, setPanel, updatePreferences } = useUI();
  const selectTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = panel === 'problems' ? 'output' : 'problems';
    setPanel(next);
    document.getElementById(`${next}-tab`)?.focus();
  };
  return (
    <section className="bottom-panel" aria-label="Diagnostics panel">
      <div className="panel-header">
        <div className="panel-tabs" role="tablist" aria-label="Diagnostics">
          {(['problems', 'output'] as const).map((name) => (
            <button
              key={name}
              role="tab"
              id={`${name}-tab`}
              aria-selected={panel === name}
              aria-controls={`${name}-panel`}
              tabIndex={panel === name ? 0 : -1}
              onClick={() => setPanel(name)}
              onKeyDown={selectTab}
            >
              {name === 'problems' ? 'Problems' : 'Output'}
              {name === 'problems' && <span className="count">0</span>}
            </button>
          ))}
        </div>
        <button
          className="icon-button small"
          aria-label="Close bottom panel"
          onClick={() => updatePreferences({ outputVisible: false })}
        >
          <X size={15} />
        </button>
      </div>
      <div
        className="panel-content"
        id={`${panel}-panel`}
        role="tabpanel"
        aria-labelledby={`${panel}-tab`}
        tabIndex={0}
      >
        {panel === 'problems' ? (
          <>
            <Check size={16} className="muted" />
            <span>
              No diagnostics yet.
              <span className="secondary-copy"> Compiler diagnostics will appear here.</span>
            </span>
          </>
        ) : (
          <>
            <Terminal size={16} className="muted" />
            <span>
              No build output.
              <span className="secondary-copy"> Local compilation is coming in Phase 1.</span>
            </span>
          </>
        )}
      </div>
    </section>
  );
}

export function App() {
  const { preferences, hydrated, error, updatePreferences, setPaletteOpen } = useUI();
  const splitContainer = useRef<HTMLDivElement>(null);
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
        updatePreferences({ outputVisible: !useUI.getState().preferences.outputVisible });
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [hydrated, setPaletteOpen, updatePreferences]);
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-symbol" aria-hidden="true">
            T<span>ε</span>
          </span>
          <span>{PRODUCT_NAME}</span>
        </div>
        <span className="topbar-divider" />
        <span className="workspace-name">Personal workspace</span>
        <button
          className="palette-trigger"
          aria-label="Command palette"
          onClick={() => setPaletteOpen(true)}
          disabled={!hydrated}
        >
          <Search size={15} />
          <span>Search commands</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="topbar-actions">
          <button
            className="icon-button"
            aria-label="Toggle sidebar"
            aria-pressed={preferences.sidebarVisible}
            title="Toggle sidebar (Ctrl+B)"
            disabled={!hydrated}
            onClick={() => updatePreferences({ sidebarVisible: !preferences.sidebarVisible })}
          >
            <PanelLeft size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Toggle bottom panel"
            aria-pressed={preferences.outputVisible}
            title="Toggle bottom panel (Ctrl+J)"
            disabled={!hydrated}
            onClick={() => updatePreferences({ outputVisible: !preferences.outputVisible })}
          >
            <PanelBottom size={18} />
          </button>
          <span className="action-divider" />
          <button
            className="icon-button"
            aria-label={`Switch to ${preferences.theme === 'dark' ? 'light' : 'dark'} theme`}
            title="Change theme"
            disabled={!hydrated}
            onClick={() =>
              updatePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' })
            }
          >
            {preferences.theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="workspace-body">
        {preferences.sidebarVisible && (
          <aside className="sidebar" aria-label="Project sidebar">
            <div className="sidebar-title">
              <span className="eyebrow">EXPLORER</span>
              <span className="subtle-label">LOCAL</span>
            </div>
            <div className="project-heading">
              <ChevronRight size={14} />
              <span>No project open</span>
            </div>
            <div className="sidebar-empty">
              <FolderOpen size={27} strokeWidth={1.3} />
              <p>A home for your ideas.</p>
              <span>Your project files will appear here when you open a folder.</span>
            </div>
            <div className="sidebar-bottom">
              <span className="local-dot" />
              <div>
                <strong>Local by design</strong>
                <p>Your files. Your computer.</p>
              </div>
            </div>
          </aside>
        )}
        <main className="document-workspace" aria-label="Document workspace">
          <div className="split-workspace" ref={splitContainer}>
            <section
              className="editor-pane"
              aria-label="Editor"
              style={{ flexBasis: `${preferences.editorWidth}%` }}
            >
              <div className="pane-header">
                <div className="welcome-tab">
                  <FileText size={15} />
                  <span>Welcome</span>
                </div>
                <span className="pane-label">EDITOR</span>
              </div>
              <div className="welcome-content">
                <span className="welcome-overline">
                  <span /> A LITTLE SPACE TO THINK
                </span>
                <h1>
                  Great ideas.
                  <br />
                  <span>Beautifully written.</span>
                </h1>
                <p className="welcome-description">
                  A quiet workspace for your next paper,
                  <br className="wide-break" /> proof, or possibility.
                </p>
                <div className="foundation-note">
                  <div className="note-icon">
                    <FileText size={19} strokeWidth={1.5} />
                  </div>
                  <div>
                    <strong>Your workspace is taking shape</strong>
                    <p>
                      This is the foundation preview. Opening projects, editing LaTeX, and compiling
                      documents are coming in Phase 1.
                    </p>
                  </div>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setPaletteOpen(true)}
                  disabled={!hydrated}
                >
                  <Search size={16} />
                  Explore commands<kbd>Ctrl K</kbd>
                </button>
                <div className="welcome-shortcuts">
                  <Keyboard size={15} />
                  <span>Make room to write</span>
                  <kbd>Ctrl B</kbd>
                  <span className="shortcut-description">toggle sidebar</span>
                </div>
              </div>
              <div className="editor-footer">
                <span>Ordinary files. Extraordinary possibilities.</span>
                <span className="phase-badge">FOUNDATION</span>
              </div>
            </section>
            <SplitHandle container={splitContainer} />
            <section className="preview-pane" aria-label="PDF preview">
              <div className="pane-header">
                <div className="preview-title">
                  <Columns2 size={15} />
                  <span>Preview</span>
                </div>
                <span className="preview-format">PDF</span>
              </div>
              <div className="preview-empty">
                <div className="paper-illustration" aria-hidden="true">
                  <span className="paper-corner" />
                  <div className="paper-symbol">∫</div>
                  <div className="paper-line long" />
                  <div className="paper-line" />
                  <div className="paper-line short" />
                </div>
                <h2>A new perspective</h2>
                <p>
                  Your compiled document will appear here.
                  <br />
                  PDF preview is coming in Phase 1.
                </p>
                <span className="preview-hint">SOURCE & RESULT, SIDE BY SIDE</span>
              </div>
            </section>
          </div>
          {preferences.outputVisible && <BottomPanel />}
        </main>
      </div>
      <footer className="statusbar">
        <div>
          <span className="local-dot" />
          <span>{hydrated ? 'Local workspace' : 'Loading preferences…'}</span>
          <span className="status-divider">/</span>
          <span>No project open</span>
        </div>
        <div>
          <span>LaTeX</span>
          <span className="status-divider">·</span>
          <span>UTF-8</span>
          <span className="status-divider">·</span>
          <span>{PRODUCT_NAME} foundation</span>
        </div>
      </footer>
      <CommandPalette />
    </div>
  );
}
