import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  Check,
  ChevronRight,
  ChevronDown,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Pin,
  Play,
  RefreshCw,
  Save,
  Square,
  X,
} from 'lucide-react';
import { BUILD_RECIPES, type Result } from '../../shared/api';
import { useUI } from './state/ui';
import {
  checkExternalChanges,
  closeDocument,
  dirty,
  discardAll,
  initializeWorkspace,
  openDocument,
  reloadDocument,
  saveAll,
  saveDocument,
  setProject,
  showError,
  useWorkspace,
} from './state/workspace';
import { SourceEditor } from './features/editor/SourceEditor';
import PdfViewer from './features/pdf/PdfViewer';

interface Prompt {
  title: string;
  detail: string;
  initial?: string;
  action: string;
  run: (value: string) => Promise<void>;
}
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function PromptDialog({ prompt, close }: { prompt: Prompt | null; close: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setValue(prompt?.initial ?? '');
    setError(null);
  }, [prompt]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prompt) return;
    setBusy(true);
    setError(null);
    try {
      await prompt.run(value.trim());
      close();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The operation failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog.Root
      open={!!prompt}
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="action-dialog">
          <form onSubmit={(event) => void submit(event)}>
            <Dialog.Title>{prompt?.title}</Dialog.Title>
            <Dialog.Description>{prompt?.detail}</Dialog.Description>
            {prompt?.initial !== undefined && (
              <label className="field-label">
                Path
                <input
                  autoFocus
                  aria-label="Path"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  required
                  disabled={busy}
                />
              </label>
            )}
            {error && (
              <p role="alert" className="dialog-error">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? 'Working…' : prompt?.action}
              </button>
            </div>
          </form>
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
    if (bounds)
      updatePreferences({
        editorWidth: Math.min(
          75,
          Math.max(30, Math.round(((event.clientX - bounds.left) / bounds.width) * 100)),
        ),
      });
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const changes: Record<string, number> = {
      ArrowLeft: preferences.editorWidth - 2,
      ArrowRight: preferences.editorWidth + 2,
      Home: 30,
      End: 75,
    };
    if (event.key in changes) {
      event.preventDefault();
      updatePreferences({ editorWidth: Math.min(75, Math.max(30, changes[event.key])) });
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
      onKeyDown={keyboard}
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
    />
  );
}

export function Workspace({ compileHost }: { compileHost: HTMLElement | null }) {
  const state = useWorkspace();
  const {
    project,
    documents,
    activePath,
    recents,
    tools,
    toolsReady,
    build,
    recipes,
    navigation,
    source,
    error,
    busy,
  } = state;
  const { preferences, updatePreferences, panel, setPanel } = useUI();
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(14);
  const [wrap, setWrap] = useState(false);
  const split = useRef<HTMLDivElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const polling = useRef(false);
  const operations = useRef(0);
  const active = documents.find((document) => document.path === activePath);
  const engine = (activePath && recipes[activePath]) || preferences.defaultRecipe;
  const canCompile = !!active && /\.tex$/i.test(active.path);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const recipeControl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!recipeOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!recipeControl.current?.contains(event.target as Node)) setRecipeOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [recipeOpen]);
  const hasDirty = documents.some(dirty);
  const currentBuild = build.projectId === project?.id ? build : null;
  useEffect(() => {
    void initializeWorkspace().catch(showError);
  }, []);
  useEffect(() => {
    void window.textra
      .setDirty(hasDirty)
      .then((result) => {
        if (!result.ok) showError(result.error);
      })
      .catch(showError);
  }, [hasDirty]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      void Promise.all([
        checkExternalChanges(),
        window.textra.getBuildState().then((result) => {
          if (result.ok) useWorkspace.setState({ build: result.value });
        }),
      ])
        .catch(showError)
        .finally(() => {
          polling.current = false;
        });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' });
  }, [build.log]);

  async function run(action: () => Promise<void>) {
    operations.current++;
    useWorkspace.setState({ busy: true, error: null });
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      operations.current--;
      useWorkspace.setState({ busy: operations.current > 0 });
    }
  }
  function protect(action: () => Promise<void>) {
    if (useWorkspace.getState().documents.some(dirty)) setPending(() => action);
    else void run(action);
  }
  function openFolder(recentId?: string) {
    if (build.running) {
      showError('Cancel the running build before switching projects.');
      return;
    }
    protect(async () => {
      const result = recentId
        ? await window.textra.openRecentProject(recentId)
        : await window.textra.chooseProject();
      const next = unwrap(result);
      if (next) {
        await setProject(next);
        setSelected(null);
      }
    });
  }
  async function refresh() {
    if (project)
      useWorkspace.setState({ project: unwrap(await window.textra.refreshProject(project.id)) });
  }
  function newEntry(kind: 'file' | 'directory') {
    if (!project) return;
    setPrompt({
      title: kind === 'file' ? 'New file' : 'New folder',
      detail: 'Enter a path relative to the project folder. Existing files are never replaced.',
      initial: '',
      action: 'Create',
      run: async (path) => {
        const next = unwrap(
          await window.textra.createEntry({
            projectId: project.id,
            path,
            kind,
            ...(kind === 'file' ? { content: '' } : {}),
          }),
        );
        useWorkspace.setState({ project: next });
        if (kind === 'file') await openDocument(path);
      },
    });
  }
  function saveAs() {
    if (!project || !active) return;
    const original = active;
    setPrompt({
      title: 'Save file as',
      detail: 'Save a copy of your current edits to a new project path. The original stays open.',
      initial: active.path.replace(/(\.[^/.]+)?$/, '-copy$1'),
      action: 'Save copy',
      run: async (path) => {
        const next = unwrap(
          await window.textra.createEntry({
            projectId: project.id,
            path,
            kind: 'file',
            content: original.content,
          }),
        );
        useWorkspace.setState({ project: next });
        await openDocument(path);
      },
    });
  }
  function rename() {
    if (!project || !selected) return;
    const path = selected;
    protect(async () => {
      setPrompt({
        title: 'Rename entry',
        detail: `Rename ${path}. Files are never overwritten.`,
        initial: path,
        action: 'Rename',
        run: async (newPath) => {
          const next = unwrap(
            await window.textra.renameEntry({ projectId: project.id, path, newPath }),
          );
          if (next) {
            const previousRoot = useWorkspace.getState().rootFile;
            const movedRoot =
              previousRoot === path || previousRoot.startsWith(`${path}/`)
                ? `${newPath}${previousRoot.slice(path.length)}`
                : previousRoot;
            useWorkspace.setState({
              project: next,
              rootFile: next.files.some((file) => file.path === movedRoot)
                ? movedRoot
                : (next.mainFile ?? ''),
            });
            for (const document of useWorkspace.getState().documents)
              if (document.path === path || document.path.startsWith(`${path}/`))
                closeDocument(document.path);
            setSelected(newPath);
          }
        },
      });
    });
  }
  function remove() {
    if (!project || !selected) return;
    const path = selected;
    protect(async () => {
      setPrompt({
        title: 'Delete entry',
        detail: `Delete ${path}? This removes it from disk. The system will ask you to confirm.`,
        action: 'Continue to confirmation',
        run: async () => {
          const next = unwrap(await window.textra.deleteEntry({ projectId: project.id, path }));
          if (next) {
            const previousRoot = useWorkspace.getState().rootFile;
            useWorkspace.setState({
              project: next,
              rootFile: next.files.some((file) => file.path === previousRoot)
                ? previousRoot
                : (next.mainFile ?? ''),
            });
            for (const document of useWorkspace.getState().documents)
              if (document.path === path || document.path.startsWith(`${path}/`))
                closeDocument(document.path);
            setSelected(null);
          }
        },
      });
    });
  }
  async function compile() {
    if (!project || !active || !canCompile || build.running || busy || prompt || pending) return;
    const rootFile = active.path;
    setRecipeOpen(false);
    await run(async () => {
      if (!(await saveAll()))
        throw new Error('Build stopped: save or resolve every unsaved file first.');
      const config = unwrap(await window.textra.getProjectConfig(project.id));
      unwrap(
        await window.textra.setProjectConfig({
          projectId: project.id,
          config: { ...config, recipes: { ...config.recipes, [rootFile]: engine } },
        }),
      );
      useWorkspace.setState((state) => ({ recipes: { ...state.recipes, [rootFile]: engine } }));
      updatePreferences({ outputVisible: true });
      setPanel('output');
      const result = await window.textra.compile({ projectId: project.id, rootFile, engine });
      useWorkspace.setState({ build: unwrap(result) });
    });
  }
  useEffect(() => {
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (useWorkspace.getState().busy || prompt || pending) return;
        if (activePath) {
          if (event.shiftKey) saveAs();
          else
            void run(async () => {
              await saveDocument(activePath);
            });
        }
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void compile();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  });
  const missingTool =
    toolsReady &&
    !(engine === 'bibtex-pipeline'
      ? tools.some((tool) => tool.name === 'pdflatex' && tool.path) &&
        tools.some((tool) => tool.name === 'bibtex' && tool.path)
      : tools.some((tool) => tool.name === engine && tool.path));

  return (
    <>
      {compileHost &&
        createPortal(
          <div
            className="compile-control"
            ref={recipeControl}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setRecipeOpen(false);
                recipeControl.current
                  ?.querySelector<HTMLButtonElement>('[aria-label="Choose compile recipe"]')
                  ?.focus();
              }
            }}
          >
            <button
              className="toolbar-button compile-button"
              aria-label={build.running ? 'Cancel build' : 'Compile active document'}
              title={
                build.running
                  ? 'Cancel build'
                  : missingTool
                    ? engine + ' not found. Check Settings & TeX setup.'
                    : 'Compile ' +
                      (activePath ?? 'active document') +
                      ' with ' +
                      engine +
                      ' (Ctrl+Enter)'
              }
              disabled={!build.running && (!canCompile || busy || !toolsReady || missingTool)}
              onClick={() =>
                build.running
                  ? void run(async () => {
                      unwrap(await window.textra.cancelBuild());
                    })
                  : void compile()
              }
            >
              {build.running ? <Square size={13} /> : <Play size={13} />}
              {build.running ? 'Cancel' : 'Compile'}
            </button>
            <button
              className="toolbar-button compile-button recipe-toggle"
              aria-label="Choose compile recipe"
              aria-expanded={recipeOpen}
              aria-controls="compile-recipes"
              disabled={!canCompile || busy || build.running}
              title={'Recipe: ' + engine}
              onClick={() => setRecipeOpen(!recipeOpen)}
            >
              <ChevronDown size={14} />
            </button>
            {recipeOpen && (
              <div
                className="recipe-menu"
                id="compile-recipes"
                role="group"
                aria-label="Compile recipe"
              >
                <span className="eyebrow">COMPILE RECIPE</span>
                {BUILD_RECIPES.map((recipe) => (
                  <button
                    key={recipe.value}
                    aria-pressed={engine === recipe.value}
                    onClick={() => {
                      if (activePath)
                        useWorkspace.setState((state) => ({
                          recipes: { ...state.recipes, [activePath]: recipe.value },
                        }));
                      setRecipeOpen(false);
                      recipeControl.current
                        ?.querySelector<HTMLButtonElement>('[aria-label="Choose compile recipe"]')
                        ?.focus();
                    }}
                  >
                    <span>{recipe.label}</span>
                    {engine === recipe.value && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>,
          compileHost,
        )}
      {error && (
        <div className="error-banner workspace-error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => useWorkspace.setState({ error: null })}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="workspace-body">
        {preferences.sidebarVisible && (
          <aside className="sidebar" aria-label="Project sidebar">
            <div className="sidebar-title">
              <span className="eyebrow">EXPLORER</span>
              <button
                className="icon-button small"
                aria-label="Open folder"
                title="Open folder"
                onClick={() => openFolder()}
                disabled={busy || build.running}
              >
                <FolderOpen size={15} />
              </button>
              {project && (
                <div className="inline-actions">
                  <button
                    className="icon-button small"
                    aria-label="New file"
                    disabled={busy}
                    onClick={() => newEntry('file')}
                  >
                    <FilePlus2 size={15} />
                  </button>
                  <button
                    className="icon-button small"
                    aria-label="New folder"
                    disabled={busy}
                    onClick={() => newEntry('directory')}
                  >
                    <FolderPlus size={15} />
                  </button>
                  <button
                    className="icon-button small"
                    aria-label="Refresh project"
                    disabled={busy}
                    onClick={() => void run(refresh)}
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
              )}
            </div>
            <div className="project-heading" title={project?.rootPath}>
              <ChevronRight size={14} />
              <span>{project?.name ?? 'No project open'}</span>
            </div>
            {project ? (
              <>
                <div className="file-tree" aria-label="Project files">
                  {project.files.map((file) => (
                    <button
                      key={file.path}
                      aria-label={
                        file.kind === 'file' ? `Open ${file.path}` : `Select folder ${file.path}`
                      }
                      aria-current={selected === file.path ? 'true' : undefined}
                      className="file-entry"
                      style={{ paddingLeft: `${15 + (file.path.split('/').length - 1) * 12}px` }}
                      onClick={() => {
                        setSelected(file.path);
                        if (file.kind === 'file') void openDocument(file.path);
                      }}
                    >
                      {file.kind === 'directory' ? <Folder size={14} /> : <FileText size={14} />}
                      <span>{file.name}</span>
                    </button>
                  ))}
                  {!project.files.length && (
                    <p className="tree-note">This folder is empty. Create a file to begin.</p>
                  )}
                  {project.truncated && (
                    <p className="tree-note">
                      The file list reached its limit. Use a smaller project folder.
                    </p>
                  )}
                </div>
                <div className="file-actions">
                  <button disabled={!selected || busy} onClick={rename}>
                    Rename
                  </button>
                  <button disabled={!selected || busy} onClick={remove}>
                    Delete
                  </button>
                  <button
                    disabled={!selected || busy}
                    onClick={() =>
                      void run(async () => {
                        unwrap(
                          await window.textra.revealEntry({
                            projectId: project.id,
                            path: selected!,
                          }),
                        );
                      })
                    }
                  >
                    Reveal
                  </button>
                  <button
                    disabled={!selected || busy}
                    onClick={() =>
                      void run(async () => {
                        unwrap(
                          await window.textra.openInCode({
                            projectId: project.id,
                            path: selected!,
                          }),
                        );
                      })
                    }
                  >
                    VS Code
                  </button>
                </div>
              </>
            ) : (
              <div className="sidebar-empty">
                <FolderOpen size={27} strokeWidth={1.3} />
                <p>A home for your ideas.</p>
                <span>Open a folder to work with ordinary LaTeX files on your computer.</span>
              </div>
            )}
            {recents.length > 0 && (
              <div className="recent-projects">
                <div className="eyebrow">RECENT PROJECTS</div>
                {[...recents]
                  .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                  .map((recent) => (
                    <div className="recent-row" key={recent.id}>
                      <button
                        className="recent-open"
                        title={recent.rootPath}
                        aria-label={`Open recent ${recent.name}`}
                        disabled={busy || build.running}
                        onClick={() => openFolder(recent.id)}
                      >
                        <FolderOpen size={13} />
                        <span>{recent.name}</span>
                      </button>
                      <button
                        className="icon-button small"
                        aria-label={`${recent.pinned ? 'Unpin' : 'Pin'} ${recent.name}`}
                        aria-pressed={recent.pinned}
                        onClick={() =>
                          void run(async () => {
                            useWorkspace.setState({
                              recents: unwrap(
                                await window.textra.setProjectPinned({
                                  id: recent.id,
                                  pinned: !recent.pinned,
                                }),
                              ),
                            });
                          })
                        }
                      >
                        <Pin size={12} />
                      </button>
                    </div>
                  ))}
              </div>
            )}
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
          <div className="split-workspace" ref={split}>
            <section
              className="editor-pane"
              aria-label="Editor"
              style={{ flexBasis: `${preferences.editorWidth}%` }}
            >
              <div className="document-tabs" role="tablist" aria-label="Open documents">
                {documents.length ? (
                  documents.map((document) => (
                    <div
                      className={`document-tab ${document.path === activePath ? 'selected' : ''}`}
                      key={document.path}
                    >
                      <button
                        role="tab"
                        aria-label={`Edit ${document.path}`}
                        aria-selected={document.path === activePath}
                        title={document.path}
                        onClick={() =>
                          useWorkspace.setState({ activePath: document.path, navigation: null })
                        }
                      >
                        <FileText size={13} />
                        <span>{document.path.split('/').at(-1)}</span>
                        {dirty(document) && (
                          <span className="dirty-dot" aria-label="Unsaved changes" />
                        )}
                      </button>
                      <button
                        className="tab-close"
                        aria-label={`Close ${document.path}`}
                        onClick={() => {
                          if (dirty(document)) protect(async () => closeDocument(document.path));
                          else closeDocument(document.path);
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="welcome-tab">
                    <FileText size={15} />
                    Welcome
                  </div>
                )}
              </div>
              {active ? (
                <>
                  <div className="editor-toolbar">
                    <span className="active-file-path" title={active.path}>
                      {active.path}
                    </span>
                    <button
                      className="icon-button small"
                      aria-label="Save file"
                      title="Save (Ctrl+S)"
                      disabled={!dirty(active) || busy || active.conflict}
                      onClick={() =>
                        void run(async () => {
                          await saveDocument(active.path);
                        })
                      }
                    >
                      <Save size={15} />
                    </button>
                    <button
                      className="text-button"
                      aria-label="Save file as"
                      disabled={busy}
                      onClick={saveAs}
                    >
                      Save as
                    </button>
                    <select
                      aria-label="Editor font size"
                      value={fontSize}
                      onChange={(event) => setFontSize(Number(event.target.value))}
                    >
                      {[12, 14, 16, 18, 20, 24].map((size) => (
                        <option key={size} value={size}>
                          {size}px
                        </option>
                      ))}
                    </select>
                    <button
                      className="text-button"
                      aria-label="Toggle word wrap"
                      aria-pressed={wrap}
                      onClick={() => setWrap(!wrap)}
                    >
                      Wrap
                    </button>
                  </div>
                  {active.conflict && (
                    <div className="conflict-banner" role="alert">
                      <span>This file changed on disk. Your open text is preserved.</span>
                      <div>
                        <button
                          onClick={() => {
                            if (dirty(active))
                              setPrompt({
                                title: 'Reload from disk',
                                detail:
                                  'Discard your unsaved edits and load the current file from disk? Save a copy first if you need both versions.',
                                action: 'Discard edits and reload',
                                run: async () => reloadDocument(active.path),
                              });
                            else void run(async () => reloadDocument(active.path));
                          }}
                        >
                          Reload from disk
                        </button>
                        <button onClick={saveAs}>Save file as</button>
                      </div>
                    </div>
                  )}
                  <SourceEditor
                    key={project?.id}
                    documents={documents}
                    activePath={active.path}
                    theme={preferences.theme}
                    navigation={navigation}
                    fontSize={fontSize}
                    wrap={wrap}
                    readOnly={busy}
                  />
                </>
              ) : (
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
                    <br /> proof, or possibility.
                  </p>
                  <div className="foundation-note">
                    <div className="note-icon">
                      <FileText size={19} />
                    </div>
                    <div>
                      <strong>
                        {project ? 'Choose a file to begin' : 'Your next document starts here'}
                      </strong>
                      <p>
                        {project
                          ? 'Select a source file from the explorer, or create a new file. Your changes stay on your computer.'
                          : 'Open a local folder to edit LaTeX, compile with your installed TeX tools, and preview the result.'}
                      </p>
                    </div>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => (project ? newEntry('file') : openFolder())}
                    disabled={busy}
                  >
                    {project ? <FilePlus2 size={16} /> : <FolderOpen size={16} />}
                    {project ? 'Create a source file' : 'Choose a project folder'}
                    <ArrowRight size={15} />
                  </button>
                  {missingTool && (
                    <p className="setup-note">
                      Install MiKTeX or TeX Live for local compilation, then restart TeXtra. Editing
                      works without TeX.
                    </p>
                  )}
                </div>
              )}
            </section>
            <SplitHandle container={split} />
            <section className="preview-pane" aria-label="PDF preview">
              <PdfViewer
                project={project}
                build={build}
                source={source}
                onNavigate={(location) => {
                  void openDocument(location.path, location);
                }}
              />
            </section>
          </div>
          {preferences.outputVisible && (
            <section className="bottom-panel live-panel" aria-label="Diagnostics panel">
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
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                          event.preventDefault();
                          const next = name === 'problems' ? 'output' : 'problems';
                          setPanel(next);
                          document.getElementById(`${next}-tab`)?.focus();
                        }
                      }}
                      onClick={() => setPanel(name)}
                    >
                      {name === 'problems' ? 'Problems' : 'Output'}
                      {name === 'problems' && (
                        <span className="count">{currentBuild?.diagnostics.length ?? 0}</span>
                      )}
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
                className="live-panel-content"
                id={`${panel}-panel`}
                role="tabpanel"
                aria-labelledby={`${panel}-tab`}
                tabIndex={0}
              >
                {panel === 'output' ? (
                  <pre className="build-log" aria-label="Build output">
                    {currentBuild?.log || 'No build output yet. Compile a root document to begin.'}
                    <div ref={logEnd} />
                  </pre>
                ) : currentBuild?.diagnostics.length ? (
                  <ul className="diagnostic-list">
                    {currentBuild.diagnostics.map((diagnostic, index) => (
                      <li key={index} className={`diagnostic ${diagnostic.severity}`}>
                        <span className="diagnostic-severity">{diagnostic.severity}</span>
                        {diagnostic.file ? (
                          <button
                            onClick={() =>
                              void openDocument(diagnostic.file!, {
                                path: diagnostic.file!,
                                line: diagnostic.line ?? 1,
                                column: 1,
                              })
                            }
                          >
                            {diagnostic.message}
                            <span>
                              {diagnostic.file}:{diagnostic.line ?? '?'}
                            </span>
                          </button>
                        ) : (
                          <span>{diagnostic.message}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="panel-content">
                    <Check size={16} />
                    <span>
                      {currentBuild?.outcome === 'success'
                        ? 'Build completed without reported diagnostics.'
                        : 'No diagnostics yet.'}
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}
        </main>
      </div>
      <PromptDialog prompt={prompt} close={() => setPrompt(null)} />
      <Dialog.Root
        open={!!pending}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="action-dialog">
            <Dialog.Title>Unsaved changes</Dialog.Title>
            <Dialog.Description>
              Some open files have unsaved edits. Save them before continuing, or explicitly discard
              the affected edits.
            </Dialog.Description>
            <ul className="dirty-files">
              {documents.filter(dirty).map((document) => (
                <li key={document.path}>{document.path}</li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button disabled={busy} onClick={() => setPending(null)}>
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  const action = pending;
                  setPending(null);
                  if (action)
                    void run(async () => {
                      await discardAll();
                      await action();
                    });
                }}
              >
                Discard and continue
              </button>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (await saveAll()) {
                      const action = pending;
                      setPending(null);
                      await action?.();
                    }
                  })
                }
              >
                Save all and continue
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
