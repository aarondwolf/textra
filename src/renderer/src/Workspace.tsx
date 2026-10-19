import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  ArrowsInSimple,
  ArrowsOutSimple,
  Check,
  ChevronRight,
  Copy,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  PanelRightClose,
  Settings,
  Search,
  Ellipsis,
  Article,
  Files,
  FilePlus2,
  FileText,
  Folder,
  History,
  FolderOpen,
  FolderPlus,
  LocateFixed,
  Pin,
  FilePdf,
  Play,
  Scroll,
  Warning,
  Pencil,
  RefreshCw,
  Save,
  Square,
  X,
} from './icons';
import { FileIcon } from './features/files/fileIcons';
import {
  BUILD_RECIPES,
  DEFAULT_PREFERENCES,
  SIDEBAR_WIDTH_RANGE,
  type BuildEngine,
  type Result,
} from '../../shared/api';
import { useUI } from './state/ui';
import { validateRecipeSettings } from '../../shared/recipes';
import {
  checkExternalChanges,
  closeDocument,
  dirty,
  discardAll,
  editDocument,
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
import EquationPalette from './features/equations/EquationPalette';
import SnippetPalette from './features/snippets/SnippetPalette';
import { DocumentView } from './features/document/DocumentView';
import { ProblemsPanel, type ProblemDiagnostic } from './features/problems/ProblemsPanel';
import { WritingPanel } from './features/writing/WritingPanel';
import {
  analyzeLatexDocument,
  extractPromptContext,
  findReferenceIssues,
  type SourceOccurrence,
} from '../../shared/writing-analysis';

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

function SidebarHandle() {
  const { preferences, updatePreferences } = useUI();
  const dragging = useRef(false);
  const clamp = (value: number) =>
    Math.round(Math.min(SIDEBAR_WIDTH_RANGE.max, Math.max(SIDEBAR_WIDTH_RANGE.min, value)));
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const sidebar = event.currentTarget.previousElementSibling;
    if (sidebar)
      updatePreferences({
        sidebarWidth: clamp(event.clientX - sidebar.getBoundingClientRect().left),
      });
  };
  return (
    <div
      className="split-handle sidebar-handle"
      role="separator"
      aria-label="Sidebar width"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_WIDTH_RANGE.min}
      aria-valuemax={SIDEBAR_WIDTH_RANGE.max}
      aria-valuenow={preferences.sidebarWidth}
      tabIndex={0}
      onKeyDown={(event) => {
        const changes: Record<string, number> = {
          ArrowLeft: preferences.sidebarWidth - 16,
          ArrowRight: preferences.sidebarWidth + 16,
          Home: SIDEBAR_WIDTH_RANGE.min,
          End: SIDEBAR_WIDTH_RANGE.max,
        };
        if (event.key in changes) {
          event.preventDefault();
          updatePreferences({ sidebarWidth: clamp(changes[event.key]) });
        }
      }}
      onDoubleClick={() => updatePreferences({ sidebarWidth: DEFAULT_PREFERENCES.sidebarWidth })}
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

/** VS Code-style inline name entry shown in the tree while creating a file or folder. */
function NewEntryRow({
  kind,
  depth,
  onSubmit,
  onCancel,
}: {
  kind: 'file' | 'directory';
  depth: number;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  async function submit() {
    const name = value.trim();
    if (!name) return onCancel();
    if (/[\\/]/.test(name)) return setError('Enter a name, not a path.');
    if (working.current) return;
    working.current = true;
    try {
      await onSubmit(name);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The item could not be created.');
    } finally {
      working.current = false;
    }
  }
  return (
    <div className="file-row new-entry" style={{ paddingLeft: `${depth * 14}px` }}>
      <div className="file-entry new-entry-field" data-invalid={error ? 'true' : undefined}>
        {kind === 'directory' ? <Folder size={14} /> : <FileText size={14} />}
        <input
          ref={input}
          aria-label={kind === 'file' ? 'New file name' : 'New folder name'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'new-entry-error' : undefined}
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          onBlur={() => {
            if (!working.current) onCancel();
          }}
        />
      </div>
      {error && (
        <p id="new-entry-error" role="alert" className="new-entry-error">
          {error}
        </p>
      )}
    </div>
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

export function Workspace({ onOpenSettings }: { onOpenSettings: () => void }) {
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
  const {
    preferences,
    updatePreferences,
    panel,
    setPanel,
    expandedPane: requestedPane,
    setExpandedPane,
  } = useUI();
  const expandedPane = preferences.previewVisible ? requestedPane : null;
  const previewFull = expandedPane === 'preview';
  const editorFull = expandedPane === 'editor';
  // Opening a file or jumping to a source line (explorer, problems, PDF double-click) needs the editor.
  useEffect(() => {
    if (useUI.getState().expandedPane === 'preview') useUI.getState().setExpandedPane(null);
  }, [activePath, navigation]);
  // With no document open the editor's restore button is gone, so never stay expanded.
  useEffect(() => {
    if (!activePath && useUI.getState().expandedPane === 'editor')
      useUI.getState().setExpandedPane(null);
  }, [activePath]);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ kind: 'file' | 'directory'; parent: string } | null>(
    null,
  );
  type SidebarView = 'explorer' | 'document' | 'writing' | 'equations' | 'snippets' | 'recents';
  const [sidebarView, setSidebarView] = useState<SidebarView>('explorer');
  const [focusMode, setFocusMode] = useState(false);
  const [projectSources, setProjectSources] = useState<Record<string, string>>({});
  const [lintDiagnostics, setLintDiagnostics] = useState<ProblemDiagnostic[]>([]);
  const [formatPreview, setFormatPreview] = useState<{ path: string; content: string } | null>(
    null,
  );
  /** Clicking the icon of the view that is already showing collapses the sidebar. */
  function selectSidebarView(view: SidebarView) {
    if (preferences.sidebarVisible && sidebarView === view) {
      updatePreferences({ sidebarVisible: false });
      return;
    }
    setSidebarView(view);
    updatePreferences({ sidebarVisible: true });
  }
  const [fileMenu, setFileMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!fileMenu) return;
    const firstAction =
      fileMenuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    (firstAction ?? fileMenuRef.current)?.focus();
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!fileMenuRef.current?.contains(event.target as Node)) setFileMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [fileMenu, activePath]);
  useEffect(() => {
    setFileMenu(null);
  }, [project?.id, preferences.sidebarVisible, sidebarView]);
  function showFileMenu(path: string, target: HTMLButtonElement) {
    setSelected(path);
    fileMenuTrigger.current = target;
    const bounds = target.getBoundingClientRect();
    setFileMenu({
      path,
      x: Math.max(4, Math.min(bounds.left + 18, window.innerWidth - 192)),
      y: Math.max(4, Math.min(bounds.bottom + 2, window.innerHeight - 260)),
    });
  }
  // Folders start collapsed; only the ones listed here are open.
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const expandPath = (previous: Set<string>, folder: string) => {
    const next = new Set(previous);
    const parts = folder.split('/').filter(Boolean);
    parts.forEach((_, index) => next.add(parts.slice(0, index + 1).join('/')));
    return next;
  };
  const [editorOptionsOpen, setEditorOptionsOpen] = useState(false);
  const editorOptions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setExpandedFolders(new Set());
  }, [project]);
  useEffect(() => {
    if (!project) {
      setProjectSources({});
      return;
    }
    let cancelled = false;
    const texFiles = project.files
      .filter((file) => file.kind === 'file' && /\.tex$/i.test(file.path))
      .slice(0, 250);
    void Promise.all(
      texFiles.map(async (file) => {
        const result = await window.textra.readFile({ projectId: project.id, path: file.path });
        return result.ok ? ([file.path, result.value.content] as const) : null;
      }),
    )
      .then((entries) => {
        if (!cancelled)
          setProjectSources(
            Object.fromEntries(
              entries.filter((entry): entry is readonly [string, string] => entry !== null),
            ),
          );
      })
      .catch(() => {
        if (!cancelled) setProjectSources({});
      });
    return () => {
      cancelled = true;
    };
  }, [project]);
  useEffect(() => {
    if (!activePath) return;
    setExpandedFolders((previous) =>
      expandPath(previous, activePath.split('/').slice(0, -1).join('/')),
    );
  }, [activePath]);
  useEffect(() => {
    if (!editorOptionsOpen) return;
    editorOptions.current?.querySelector<HTMLButtonElement>('.editor-options-menu button')?.focus();
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!editorOptions.current?.contains(event.target as Node)) setEditorOptionsOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [editorOptionsOpen]);
  function revealActive() {
    if (!activePath) return;
    setFileMenu(null);
    updatePreferences({ sidebarVisible: true });
    setSidebarView('explorer');
    setExpandedFolders((previous) =>
      expandPath(previous, activePath.split('/').slice(0, -1).join('/')),
    );
    setSelected(activePath);
    window.requestAnimationFrame(() => {
      document
        .querySelector(`.file-entry[data-path="${CSS.escape(activePath)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }
  function toggleFolder(path: string) {
    setFileMenu(null);
    setSelected(path);
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }
  const visibleFiles =
    project?.files.filter(
      (file) =>
        !file.path
          .split('/')
          .slice(0, -1)
          .some((_, index, parts) => !expandedFolders.has(parts.slice(0, index + 1).join('/'))),
    ) ?? [];
  const { fontSize, wrap } = preferences;
  const setFontSize = (size: number) => updatePreferences({ fontSize: size });
  const setWrap = (value: boolean) => updatePreferences({ wrap: value });
  const split = useRef<HTMLDivElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const polling = useRef(false);
  const operations = useRef(0);
  const active = documents.find((document) => document.path === activePath);
  const recipeSettings = useMemo(
    () => validateRecipeSettings(state.projectConfig ?? {}),
    [state.projectConfig],
  );
  const availableRecipes = recipeSettings['latex-workshop.latex.recipes'];
  const defaultRecipe = recipeSettings['latex-workshop.latex.recipe.default'];
  const preferred =
    (activePath && recipes[activePath]) ||
    (defaultRecipe === 'first'
      ? availableRecipes[0].name
      : defaultRecipe === 'lastUsed'
        ? preferences.defaultRecipe || DEFAULT_PREFERENCES.defaultRecipe
        : defaultRecipe);
  const engine = availableRecipes.some((recipe) => recipe.name === preferred)
    ? preferred
    : availableRecipes[0].name;
  const canCompile = !!active && /\.tex$/i.test(active.path);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const recipeControl = useRef<HTMLDivElement>(null);
  const [pdfSlot, setPdfSlot] = useState<HTMLDivElement | null>(null);
  const [headerNode, setHeaderNode] = useState<HTMLDivElement | null>(null);
  const [headerCompact, setHeaderCompact] = useState(false);
  const [logCopied, setLogCopied] = useState(false);
  const [tabsHost, setTabsHost] = useState<HTMLDivElement | null>(null);
  const [tabMode, setTabMode] = useState<'full' | 'icons' | 'menu'>('full');
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [pdfMenuSlot, setPdfMenuSlot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tabsHost) return;
    // Conservative thresholds: switch to icons, then to a menu, a little before things collide.
    const measure = () => {
      const width = tabsHost.clientWidth;
      setTabMode(width >= 250 ? 'full' : width >= 112 ? 'icons' : 'menu');
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tabsHost);
    return () => observer.disconnect();
  }, [tabsHost]);
  useEffect(() => {
    if (tabMode !== 'menu') setTabMenuOpen(false);
  }, [tabMode]);
  useEffect(() => {
    if (!tabMenuOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!tabsHost?.contains(event.target as Node)) setTabMenuOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setTabMenuOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  }, [tabMenuOpen, tabsHost]);
  useEffect(() => {
    if (!headerNode) return;
    const measure = () => setHeaderCompact(headerNode.clientWidth < 560);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(headerNode);
    return () => observer.disconnect();
  }, [headerNode]);
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
  const analysisSources = useMemo(() => {
    const next = { ...projectSources };
    for (const document of documents)
      if (/\.tex$/i.test(document.path)) next[document.path] = document.content;
    return next;
  }, [documents, projectSources]);
  const documentAnalysis = useMemo(
    () => (active && /\.tex$/i.test(active.path) ? analyzeLatexDocument(active.content) : null),
    [active],
  );
  const referenceDiagnostics = useMemo<ProblemDiagnostic[]>(() => {
    const labels: Array<SourceOccurrence & { file: string }> = [];
    const references: Array<SourceOccurrence & { file: string }> = [];
    const graphics: Array<SourceOccurrence & { file: string }> = [];
    for (const [path, content] of Object.entries(analysisSources)) {
      const analysis = analyzeLatexDocument(content);
      labels.push(...analysis.labels.map((item) => ({ ...item, file: path })));
      references.push(...analysis.references.map((item) => ({ ...item, file: path })));
      graphics.push(...analysis.graphics.map((item) => ({ ...item, file: path })));
    }
    const issues: ProblemDiagnostic[] = [];
    for (const issue of findReferenceIssues(labels, references))
      for (const occurrence of issue.occurrences as Array<SourceOccurrence & { file: string }>)
        issues.push({
          severity: 'warning',
          source: 'reference',
          code: issue.kind,
          message:
            issue.kind === 'duplicate-label'
              ? `Duplicate label: ${issue.value}`
              : `Missing label: ${issue.value}`,
          file: occurrence.file,
          line: occurrence.line,
          column: occurrence.column,
        });
    const knownFiles = new Set(
      project?.files.filter((file) => file.kind === 'file').map((file) => file.path) ?? [],
    );
    for (const graphic of graphics) {
      const candidate = graphic.value.replace(/^\{+|\}+$/g, '').replace(/^\.\//, '');
      const exists = [...knownFiles].some(
        (path) => path === candidate || path.replace(/\.[^.]+$/, '') === candidate,
      );
      if (!exists)
        issues.push({
          severity: 'warning',
          source: 'reference',
          code: 'missing-graphic',
          message: `Missing graphic: ${graphic.value}`,
          file: graphic.file,
          line: graphic.line,
          column: graphic.column,
        });
    }
    return issues;
  }, [analysisSources, project?.files]);
  const problemDiagnostics = useMemo<ProblemDiagnostic[]>(
    () => [...(currentBuild?.diagnostics ?? []), ...lintDiagnostics, ...referenceDiagnostics],
    [currentBuild?.diagnostics, lintDiagnostics, referenceDiagnostics],
  );
  const errorCount = problemDiagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = problemDiagnostics.filter((d) => d.severity === 'warning').length;
  const issueCount = errorCount + warningCount;
  const issueSeverity: 'error' | 'warning' | 'ok' | 'none' = errorCount
    ? 'error'
    : warningCount
      ? 'warning'
      : currentBuild && currentBuild.outcome !== 'idle' && currentBuild.outcome !== 'running'
        ? currentBuild.outcome === 'success'
          ? 'ok'
          : 'error'
        : 'none';
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
    // Pick up files created or removed outside TeXtra when the window regains focus.
    const onFocus = () => {
      if (operations.current === 0) void refresh().catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);
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
    // Create beside the selection: inside a selected folder, or next to a selected file.
    const selectedEntry = project.files.find((file) => file.path === selected);
    const parent =
      selectedEntry?.kind === 'directory'
        ? selectedEntry.path
        : selectedEntry
          ? selectedEntry.path.split('/').slice(0, -1).join('/')
          : '';
    setFileMenu(null);
    updatePreferences({ sidebarVisible: true });
    setSidebarView('explorer');
    setExpandedFolders((previous) => expandPath(previous, parent));
    setCreating({ kind, parent });
  }
  async function createInline(name: string) {
    if (!project || !creating) return;
    const path = creating.parent ? `${creating.parent}/${name}` : name;
    const next = unwrap(
      await window.textra.createEntry({
        projectId: project.id,
        path,
        kind: creating.kind,
        ...(creating.kind === 'file' ? { content: '' } : {}),
      }),
    );
    useWorkspace.setState({ project: next });
    setCreating(null);
    setSelected(path);
    if (creating.kind === 'file') await openDocument(path);
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
  async function lintDocument(path: string) {
    if (!project || !/\.tex$/i.test(path)) return;
    const result = await window.textra.lintLatex({ projectId: project.id, path });
    if (!result.ok) {
      // ChkTeX is optional, so a missing executable does not interrupt saving.
      if (result.code !== 'TOOL_MISSING') showError(result.error);
      return;
    }
    setLintDiagnostics((previous) => [
      ...previous.filter(
        (diagnostic) => diagnostic.source !== 'chktex' || diagnostic.file !== path,
      ),
      ...result.value,
    ]);
  }
  async function saveAndLint(path: string) {
    if (await saveDocument(path)) await lintDocument(path);
  }
  async function formatActive() {
    if (!project || !active || !/\.tex$/i.test(active.path)) return;
    const result = await window.textra.formatLatex({
      projectId: project.id,
      path: active.path,
      content: active.content,
    });
    if (!result.ok) throw new Error(result.error);
    setFormatPreview({ path: active.path, content: result.value.content });
  }
  async function copyProblemPrompt(diagnostic: ProblemDiagnostic) {
    let source = diagnostic.file ? analysisSources[diagnostic.file] : undefined;
    if (!source && project && diagnostic.file) {
      const result = await window.textra.readFile({ projectId: project.id, path: diagnostic.file });
      if (result.ok) source = result.value.content;
    }
    const context = source ? extractPromptContext(source, diagnostic.line ?? 1) : null;
    const location = diagnostic.file ? ` in \`${diagnostic.file}:${diagnostic.line ?? '?'}\`` : '';
    const prompt = [
      '# LaTeX troubleshooting request',
      '',
      `I am working on a LaTeX document and received this ${diagnostic.severity}${location}:`,
      '',
      `> ${diagnostic.code ? `${diagnostic.code}: ` : ''}${diagnostic.message}`,
      ...(context
        ? [
            '',
            `## Source context${context.environment ? ` (${context.environment} environment)` : ''}`,
            `Lines ${context.startLine}-${context.endLine}:`,
            '',
            '```latex',
            context.text,
            '```',
          ]
        : []),
      '',
      'Please explain the likely cause and suggest the smallest safe correction.',
    ].join('\n');
    await navigator.clipboard.writeText(prompt);
  }
  async function compile() {
    if (!project || !active || !canCompile || build.running || busy || prompt || pending) return;
    const rootFile = active.path;
    setRecipeOpen(false);
    await run(async () => {
      if (!(await saveAll()))
        throw new Error('Build stopped: save or resolve every unsaved file first.');
      try {
        let config = unwrap(await window.textra.getProjectConfig(project.id));
        if (config.recipes?.[rootFile] !== engine) {
          config = unwrap(
            await window.textra.setProjectConfig({
              projectId: project.id,
              config: { ...config, recipes: { ...config.recipes, [rootFile]: engine } },
              expectedConfig: config,
            }),
          );
        }
        useWorkspace.setState({ projectConfig: config });
      } catch (error) {
        showError(
          `The recipe could not be remembered: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      useWorkspace.setState((state) => ({ recipes: { ...state.recipes, [rootFile]: engine } }));
      const result = await window.textra.compile({
        projectId: project.id,
        rootFile,
        engine: BUILD_RECIPES.some((recipe) => recipe.value === engine)
          ? (engine as BuildEngine)
          : 'pdflatex',
        recipe: engine,
      });
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
              await saveAndLint(activePath);
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
  const selectedSteps = availableRecipes.find((recipe) => recipe.name === engine)!.tools;
  const missingTool =
    toolsReady &&
    selectedSteps.some((name) => {
      const command = recipeSettings['latex-workshop.latex.tools']
        .find((tool) => tool.name === name)!
        .command.replace(/\.exe$/i, '')
        .toLowerCase();
      return !tools.some((tool) => tool.name === command && tool.path);
    });

  return (
    <>
      {error && (
        <div className="error-banner workspace-error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => useWorkspace.setState({ error: null })}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="workspace-body">
        <nav className="activity-rail" aria-label="Workspace controls">
          <button
            className="icon-button"
            aria-label="Toggle sidebar"
            title={
              preferences.sidebarVisible ? 'Collapse sidebar (Ctrl+B)' : 'Expand sidebar (Ctrl+B)'
            }
            aria-pressed={preferences.sidebarVisible}
            onClick={() => updatePreferences({ sidebarVisible: !preferences.sidebarVisible })}
          >
            {preferences.sidebarVisible ? (
              <PanelLeftClose size={19} />
            ) : (
              <PanelLeftOpen size={19} />
            )}
          </button>
          <button
            className="icon-button activity-view"
            aria-label="File Explorer"
            title="File Explorer"
            aria-pressed={preferences.sidebarVisible && sidebarView === 'explorer'}
            onClick={() => selectSidebarView('explorer')}
          >
            <Files
              size={20}
              weight={
                preferences.sidebarVisible && sidebarView === 'explorer' ? 'duotone' : 'light'
              }
            />
          </button>
          <button
            className="icon-button activity-view"
            aria-label="Document view"
            title="Document: outline and files used"
            aria-pressed={preferences.sidebarVisible && sidebarView === 'document'}
            onClick={() => selectSidebarView('document')}
          >
            <Article
              size={20}
              weight={
                preferences.sidebarVisible && sidebarView === 'document' ? 'duotone' : 'light'
              }
            />
          </button>
          <button
            className="icon-button activity-view"
            aria-label="Equations"
            title="Equations: symbol palette"
            aria-pressed={preferences.sidebarVisible && sidebarView === 'equations'}
            onClick={() => selectSidebarView('equations')}
          >
            <span className="sigma-icon" aria-hidden="true">
              Σ
            </span>
          </button>
          <button
            className="icon-button activity-view"
            aria-label="Writing tools"
            title="Writing: outline, counts and notes"
            aria-pressed={preferences.sidebarVisible && sidebarView === 'writing'}
            onClick={() => selectSidebarView('writing')}
          >
            <Pencil
              size={19}
              weight={preferences.sidebarVisible && sidebarView === 'writing' ? 'duotone' : 'light'}
            />
          </button>
          <button
            className="icon-button activity-view"
            aria-label="Snippets"
            title="Snippets: tables, figures and more"
            aria-pressed={preferences.sidebarVisible && sidebarView === 'snippets'}
            onClick={() => selectSidebarView('snippets')}
          >
            <span className="brace-icon" aria-hidden="true">
              {'{}'}
            </span>
          </button>
          <button
            className="icon-button"
            aria-label="Command palette"
            title="Search commands (Ctrl+K)"
            onClick={() => useUI.getState().setPaletteOpen(true)}
          >
            <Search size={18} />
          </button>
          <button
            className="icon-button activity-view rail-bottom"
            aria-label="Recent Projects"
            title="Recent Projects"
            aria-pressed={preferences.sidebarVisible && sidebarView === 'recents'}
            onClick={() => selectSidebarView('recents')}
          >
            <History
              size={20}
              weight={preferences.sidebarVisible && sidebarView === 'recents' ? 'duotone' : 'light'}
            />
          </button>
          <button
            className="icon-button"
            aria-label="Settings and TeX setup"
            title="Settings"
            onClick={onOpenSettings}
          >
            <Settings size={19} />
          </button>
        </nav>
        {preferences.sidebarVisible && (
          <aside
            className="sidebar"
            aria-label="Project sidebar"
            style={{ width: preferences.sidebarWidth }}
          >
            {sidebarView === 'document' ? (
              <DocumentView />
            ) : sidebarView === 'writing' ? (
              <WritingPanel
                summary={{
                  words: documentAnalysis?.counts.words ?? 0,
                  characters: active?.content.length ?? 0,
                  sections: documentAnalysis?.counts.sections ?? 0,
                  equations: documentAnalysis?.counts.equations ?? 0,
                  figures: documentAnalysis?.counts.figures ?? 0,
                  tables: documentAnalysis?.counts.tables ?? 0,
                  outline: (documentAnalysis?.outline ?? []).map((item, index) => ({
                    id: `${item.line}:${index}`,
                    title: item.title,
                    line: item.line,
                    level: item.level,
                  })),
                  todos: (documentAnalysis?.todos ?? []).map((item, index) => ({
                    id: `${item.line}:${index}`,
                    line: item.line,
                    kind: item.kind,
                    text: item.text,
                  })),
                }}
                activeLine={source?.path === active?.path ? (source?.line ?? null) : null}
                focusMode={focusMode}
                onJumpToLine={(line) => {
                  if (active)
                    void openDocument(active.path, { path: active.path, line, column: 1 });
                }}
                onToggleFocusMode={() => setFocusMode((value) => !value)}
              />
            ) : sidebarView === 'snippets' ? (
              <>
                <div className="sidebar-title">
                  <span className="sidebar-heading">Snippets</span>
                </div>
                <SnippetPalette canInsert={!!active} />
              </>
            ) : sidebarView === 'recents' ? (
              <>
                <div className="sidebar-title">
                  <span className="sidebar-heading">Recent Projects</span>
                  <button
                    className="icon-button small"
                    aria-label="Open folder"
                    title="Open folder"
                    onClick={() => openFolder()}
                    disabled={busy || build.running}
                  >
                    <FolderOpen size={15} />
                  </button>
                </div>
                {recents.length > 0 ? (
                  <div className="recent-project-list recent-project-list-full">
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
                            title={`${recent.pinned ? 'Unpin' : 'Pin'} ${recent.name}`}
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
                ) : (
                  <div className="sidebar-empty">
                    <History size={27} weight="thin" />
                    <p>No recent projects.</p>
                    <span>Folders you open will show up here.</span>
                  </div>
                )}
              </>
            ) : sidebarView === 'equations' ? (
              <>
                <div className="sidebar-title">
                  <span className="sidebar-heading">Equations</span>
                </div>
                <EquationPalette canInsert={!!active} />
              </>
            ) : (
              <>
                <div className="sidebar-title">
                  <span className="sidebar-heading">Files</span>
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
                        title="New file"
                        disabled={busy}
                        onClick={() => newEntry('file')}
                      >
                        <FilePlus2 size={15} />
                      </button>
                      <button
                        className="icon-button small"
                        aria-label="New folder"
                        title="New folder"
                        disabled={busy}
                        onClick={() => newEntry('directory')}
                      >
                        <FolderPlus size={15} />
                      </button>
                      <button
                        className="icon-button small"
                        aria-label="Reveal active file in explorer"
                        title="Reveal active file in explorer"
                        disabled={!activePath}
                        onClick={revealActive}
                      >
                        <LocateFixed size={14} />
                      </button>
                      <button
                        className="icon-button small"
                        aria-label="Refresh project"
                        title="Refresh project"
                        disabled={busy}
                        onClick={() => void run(refresh)}
                      >
                        <RefreshCw size={14} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="project-heading" title={project?.rootPath}>
                  <span>{project?.name ?? 'No project open'}</span>
                </div>
                {project ? (
                  <>
                    <div className="file-tree" aria-label="Project files">
                      {creating?.parent === '' && (
                        <NewEntryRow
                          kind={creating.kind}
                          depth={0}
                          onSubmit={createInline}
                          onCancel={() => setCreating(null)}
                        />
                      )}
                      {visibleFiles.map((file) => (
                        <Fragment key={file.path}>
                          <div
                            className="file-row"
                            style={{
                              paddingLeft: `${(file.path.split('/').length - 1) * 14}px`,
                            }}
                          >
                            <button
                              aria-label={
                                file.kind === 'file'
                                  ? `Open ${file.path}`
                                  : `Select folder ${file.path}`
                              }
                              aria-current={selected === file.path ? 'true' : undefined}
                              className="file-entry"
                              data-path={file.path}
                              disabled={busy}
                              aria-expanded={
                                file.kind === 'directory'
                                  ? expandedFolders.has(file.path)
                                  : undefined
                              }
                              onClick={() => {
                                if (file.kind === 'directory') toggleFolder(file.path);
                                else {
                                  setFileMenu(null);
                                  setSelected(file.path);
                                  void openDocument(file.path);
                                }
                              }}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                showFileMenu(file.path, event.currentTarget);
                              }}
                              onKeyDown={(event) => {
                                if (
                                  file.kind === 'directory' &&
                                  (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                                ) {
                                  event.preventDefault();
                                  setExpandedFolders((previous) => {
                                    const next = new Set(previous);
                                    if (event.key === 'ArrowLeft') next.delete(file.path);
                                    else next.add(file.path);
                                    return next;
                                  });
                                }
                                if (
                                  (event.shiftKey && event.key === 'F10') ||
                                  event.key === 'ContextMenu'
                                ) {
                                  event.preventDefault();
                                  showFileMenu(file.path, event.currentTarget);
                                }
                              }}
                            >
                              {file.kind === 'directory' ? (
                                <>
                                  <ChevronRight
                                    size={12}
                                    aria-hidden="true"
                                    className={
                                      'folder-chevron' +
                                      (expandedFolders.has(file.path) ? ' expanded' : '')
                                    }
                                  />
                                  <FileIcon
                                    name={file.name}
                                    kind="directory"
                                    expanded={expandedFolders.has(file.path)}
                                  />
                                </>
                              ) : (
                                <FileIcon name={file.name} kind="file" />
                              )}
                              <span>{file.name}</span>
                            </button>
                            {selected === file.path && (
                              <button
                                className="file-more"
                                aria-label={`More actions for ${file.path}`}
                                title="More actions"
                                aria-haspopup="menu"
                                aria-expanded={fileMenu?.path === file.path}
                                disabled={busy}
                                onClick={(event) => showFileMenu(file.path, event.currentTarget)}
                              >
                                <Ellipsis size={14} />
                              </button>
                            )}
                          </div>
                          {creating &&
                            creating.parent === file.path &&
                            file.kind === 'directory' && (
                              <NewEntryRow
                                kind={creating.kind}
                                depth={file.path.split('/').length}
                                onSubmit={createInline}
                                onCancel={() => setCreating(null)}
                              />
                            )}
                        </Fragment>
                      ))}
                      {!project.files.length && !creating && (
                        <p className="tree-note">This folder is empty. Create a file to begin.</p>
                      )}
                      {project.truncated && (
                        <p className="tree-note">
                          The file list reached its limit. Use a smaller project folder.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="sidebar-empty">
                    <FolderOpen size={27} weight="thin" />
                    <p>A home for your ideas.</p>
                    <span>Open a folder to work with ordinary LaTeX files on your computer.</span>
                  </div>
                )}
              </>
            )}
          </aside>
        )}
        {preferences.sidebarVisible && <SidebarHandle />}
        <main className="document-workspace" aria-label="Document workspace">
          <div className="split-workspace" ref={split}>
            <section
              className="editor-pane"
              aria-label="Editor"
              hidden={previewFull}
              style={{
                flexBasis:
                  preferences.previewVisible && !editorFull ? `${preferences.editorWidth}%` : 0,
                flexGrow: preferences.previewVisible && !editorFull ? 0 : 1,
              }}
            >
              <div className="editor-tab-strip">
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
                {active && (
                  <div className="editor-tab-actions">
                    <button
                      className="icon-button small"
                      aria-label="Save file"
                      title="Save (Ctrl+S)"
                      disabled={!dirty(active) || busy || active.conflict}
                      onClick={() =>
                        void run(async () => {
                          await saveAndLint(active.path);
                        })
                      }
                    >
                      <Save size={15} />
                    </button>
                    {/* Expand-editor button disabled: "Collapse right pane" covers it.
                        Wiring (expandedPane "editor", palette command, effects) is kept
                        so the decision can be revisited.
                    {preferences.previewVisible && (
                      <button
                        className="icon-button small"
                        aria-label={
                          editorFull
                            ? 'Restore editor and preview split'
                            : 'Expand editor to full width'
                        }
                        title={
                          editorFull
                            ? 'Restore editor and preview split'
                            : 'Expand editor to full width (Ctrl+Enter still compiles)'
                        }
                        aria-pressed={editorFull}
                        onClick={() => setExpandedPane(editorFull ? null : 'editor')}
                      >
                        {editorFull ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}
                      </button>
                    )}
                    */}
                    <div
                      className="editor-options"
                      ref={editorOptions}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          setEditorOptionsOpen(false);
                          editorOptions.current
                            ?.querySelector<HTMLButtonElement>('[aria-label="Editor options"]')
                            ?.focus();
                        }
                      }}
                    >
                      <button
                        className="icon-button small"
                        aria-label="Editor options"
                        title="Editor options"
                        aria-expanded={editorOptionsOpen}
                        aria-controls="editor-options-panel"
                        onClick={() => setEditorOptionsOpen(!editorOptionsOpen)}
                      >
                        <Ellipsis size={17} />
                      </button>
                      {editorOptionsOpen && (
                        <div
                          className="editor-options-menu"
                          id="editor-options-panel"
                          role="group"
                          aria-label="Editor options"
                        >
                          <button
                            className="text-button"
                            aria-label="Save file as"
                            disabled={busy}
                            onClick={() => {
                              setEditorOptionsOpen(false);
                              saveAs();
                            }}
                          >
                            Save as…
                          </button>
                          <label>
                            Font size
                            <select
                              aria-label="Editor font size"
                              value={fontSize}
                              onChange={(event) => setFontSize(Number(event.target.value))}
                            >
                              {[...new Set([12, 14, 16, 18, 20, 24, fontSize])]
                                .sort((a, b) => a - b)
                                .map((size) => (
                                  <option key={size} value={size}>
                                    {size}px
                                  </option>
                                ))}
                            </select>
                          </label>
                          <button
                            className="text-button"
                            aria-label="Toggle word wrap"
                            aria-pressed={wrap}
                            onClick={() => setWrap(!wrap)}
                          >
                            Word wrap <span>{wrap ? 'On' : 'Off'}</span>
                          </button>
                          <button
                            className="text-button"
                            aria-label="Format document with latexindent"
                            disabled={busy || !/\.tex$/i.test(active.path)}
                            onClick={() => {
                              setEditorOptionsOpen(false);
                              void run(formatActive);
                            }}
                          >
                            Format document…
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {active ? (
                <>
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
                  <h1>{project ? 'Open a file' : 'Start writing'}</h1>
                  <p className="welcome-description">
                    {project
                      ? 'Choose a file from the explorer, or create one.'
                      : 'Open a folder to begin.'}
                  </p>
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
                    <p className="setup-note">Set up a TeX distribution in Settings to compile.</p>
                  )}
                </div>
              )}
            </section>
            {preferences.previewVisible && !expandedPane && <SplitHandle container={split} />}
            <section
              className="preview-pane"
              aria-label="Preview pane"
              hidden={!preferences.previewVisible || editorFull}
              onKeyDown={(event) => {
                if (event.defaultPrevented || !(event.ctrlKey || event.metaKey)) return;
                if (event.key.toLowerCase() === 'f' && panel === 'preview') {
                  event.preventDefault();
                  window.dispatchEvent(new Event('textra:find-pdf'));
                } else if (event.key.toLowerCase() === 'h') {
                  event.preventDefault();
                  window.dispatchEvent(new Event('textra:replace-source'));
                }
              }}
            >
              <div className="preview-header" ref={setHeaderNode}>
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
                        : !canCompile
                          ? 'Open a .tex document to compile it.'
                          : busy
                            ? 'Wait for the current file operation to finish.'
                            : missingTool
                              ? engine + ' not found. Check Settings, LaTeX tools.'
                              : 'Compile ' +
                                (activePath ?? 'active document') +
                                ' with ' +
                                engine +
                                ' (Ctrl+Enter)'
                    }
                    style={
                      build.running && build.stepCount
                        ? ({
                            '--progress': `${Math.min(
                              95,
                              (((build.stepsDone ?? 0) + 0.5) / build.stepCount) * 100,
                            )}%`,
                          } as CSSProperties)
                        : undefined
                    }
                    data-progress={build.running && build.stepCount ? 'true' : undefined}
                    disabled={!build.running && (!canCompile || busy)}
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
                    onClick={() => {
                      if (recipeOpen) setRecipeOpen(false);
                      else if (project)
                        void run(async () => {
                          const config = unwrap(await window.textra.getProjectConfig(project.id));
                          useWorkspace.setState({ projectConfig: config });
                          setRecipeOpen(true);
                        });
                    }}
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
                      {availableRecipes.map((recipe) => (
                        <button
                          key={recipe.name}
                          aria-pressed={engine === recipe.name}
                          onClick={() => {
                            if (activePath)
                              useWorkspace.setState((state) => ({
                                recipes: { ...state.recipes, [activePath]: recipe.name },
                              }));
                            setRecipeOpen(false);
                            recipeControl.current
                              ?.querySelector<HTMLButtonElement>(
                                '[aria-label="Choose compile recipe"]',
                              )
                              ?.focus();
                          }}
                        >
                          <span>
                            {BUILD_RECIPES.find((preset) => preset.value === recipe.name)?.label ??
                              recipe.name}
                          </span>
                          {engine === recipe.name && <Check size={14} />}
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          setRecipeOpen(false);
                          useUI.getState().setRecipeEditorOpen(true);
                        }}
                      >
                        Manage recipes…
                      </button>
                    </div>
                  )}
                </div>
                <div className="preview-tabs-host" ref={setTabsHost}>
                  {tabMode === 'menu' ? (
                    <>
                      <button
                        className="icon-button small"
                        aria-label="Preview menu"
                        aria-haspopup="menu"
                        aria-expanded={tabMenuOpen}
                        title="Views and PDF controls"
                        onClick={() => setTabMenuOpen((open) => !open)}
                      >
                        <Ellipsis size={17} />
                      </button>
                      {tabMenuOpen && (
                        <div className="preview-tabs-menu" role="menu" aria-label="Preview views">
                          {(['preview', 'problems', 'output'] as const).map((name) => (
                            <button
                              key={name}
                              role="menuitemradio"
                              aria-checked={panel === name}
                              onClick={() => {
                                setPanel(name);
                                setTabMenuOpen(false);
                              }}
                            >
                              {name === 'preview' ? (
                                <FilePdf size={15} />
                              ) : name === 'problems' ? (
                                <Warning size={15} />
                              ) : (
                                <Scroll size={15} />
                              )}
                              {name === 'preview'
                                ? 'Preview'
                                : name === 'problems'
                                  ? 'Problems'
                                  : 'Output'}
                              {name === 'problems' && !!problemDiagnostics.length && (
                                <span className="count">{problemDiagnostics.length}</span>
                              )}
                            </button>
                          ))}
                          {panel === 'preview' && (
                            <div className="preview-menu-pdf" ref={setPdfMenuSlot} />
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      className="preview-tabs"
                      role="tablist"
                      aria-label="Preview views"
                      data-mode={tabMode}
                    >
                      {(['preview', 'problems', 'output'] as const).map((name, index, names) => (
                        <button
                          key={name}
                          role="tab"
                          id={name + '-tab'}
                          aria-selected={panel === name}
                          aria-controls={name + '-panel'}
                          tabIndex={panel === name ? 0 : -1}
                          onClick={() => setPanel(name)}
                          title={
                            name === 'preview'
                              ? 'Preview'
                              : name === 'problems'
                                ? 'Problems'
                                : 'Output'
                          }
                          aria-label={
                            name === 'preview'
                              ? 'Preview'
                              : name === 'problems'
                                ? 'Problems'
                                : 'Output'
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                              event.preventDefault();
                              const next =
                                names[
                                  (index + (event.key === 'ArrowRight' ? 1 : names.length - 1)) %
                                    names.length
                                ];
                              setPanel(next);
                              document.getElementById(next + '-tab')?.focus();
                            }
                          }}
                        >
                          {tabMode === 'icons' &&
                            (name === 'preview' ? (
                              <FilePdf size={16} />
                            ) : name === 'problems' ? (
                              <Warning size={16} />
                            ) : (
                              <Scroll size={16} />
                            ))}
                          {tabMode === 'full' &&
                            (name === 'preview'
                              ? 'Preview'
                              : name === 'problems'
                                ? 'Problems'
                                : 'Output')}
                          {name === 'problems' && !!problemDiagnostics.length && (
                            <span className="count">{problemDiagnostics.length}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="pdf-slot" ref={setPdfSlot} />
                {panel === 'output' && (
                  <button
                    className="icon-button small header-secondary"
                    aria-label="Copy build output"
                    title={logCopied ? 'Copied' : 'Copy build output'}
                    disabled={!currentBuild?.log}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(currentBuild?.log ?? '')
                        .then(() => {
                          setLogCopied(true);
                          window.setTimeout(() => setLogCopied(false), 1500);
                        })
                        .catch(() => undefined);
                    }}
                  >
                    {logCopied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                )}
                <button
                  className="icon-button small header-secondary"
                  aria-label={
                    previewFull
                      ? 'Restore editor and preview split'
                      : 'Expand preview to full width'
                  }
                  title={
                    previewFull
                      ? 'Restore editor and preview split'
                      : 'Expand preview to full width'
                  }
                  aria-pressed={previewFull}
                  onClick={() => setExpandedPane(previewFull ? null : 'preview')}
                >
                  {previewFull ? <ArrowsInSimple size={16} /> : <ArrowsOutSimple size={16} />}
                </button>
                <button
                  className="icon-button small"
                  aria-label="Collapse preview"
                  title="Collapse preview"
                  onClick={() => {
                    setExpandedPane(null);
                    updatePreferences({ previewVisible: false });
                  }}
                >
                  <PanelRightClose size={17} />
                </button>
              </div>
              <div
                className="pdf-tab-content"
                id="preview-panel"
                role="tabpanel"
                aria-labelledby="preview-tab"
                hidden={panel !== 'preview'}
              >
                <PdfViewer
                  project={project}
                  build={build}
                  source={source}
                  toolbarSlot={pdfSlot}
                  compact={headerCompact}
                  menuMode={tabMode === 'menu'}
                  menuSlot={pdfMenuSlot}
                  active={panel === 'preview'}
                  onNavigate={(location) => {
                    void openDocument(location.path, location);
                  }}
                />
              </div>
              {panel !== 'preview' && (
                <div
                  className="preview-diagnostics"
                  id={`${panel}-panel`}
                  role="tabpanel"
                  aria-labelledby={`${panel}-tab`}
                  tabIndex={0}
                >
                  {panel === 'output' ? (
                    <pre className="build-log" aria-label="Build output">
                      {currentBuild?.log ||
                        'No build output yet. Compile a root document to begin.'}
                      <div ref={logEnd} />
                    </pre>
                  ) : problemDiagnostics.length ? (
                    <ProblemsPanel
                      diagnostics={problemDiagnostics}
                      onNavigate={(diagnostic) => {
                        if (diagnostic.file)
                          void openDocument(diagnostic.file, {
                            path: diagnostic.file,
                            line: diagnostic.line ?? 1,
                            column: diagnostic.column ?? 1,
                          });
                      }}
                      onSearchStackExchange={(diagnostic) => {
                        void window.textra
                          .openStackExchangeSearch(
                            `${diagnostic.code ?? ''} ${diagnostic.message}`.trim(),
                          )
                          .then((result) => {
                            if (!result.ok) showError(result.error);
                          });
                      }}
                      onCopyPrompt={(diagnostic) =>
                        void copyProblemPrompt(diagnostic).catch(showError)
                      }
                    />
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
              )}
            </section>
            {!preferences.previewVisible && (
              <div className="preview-collapsed">
                <button
                  className="icon-button small"
                  aria-label="Expand preview"
                  title="Expand preview"
                  onClick={() => updatePreferences({ previewVisible: true })}
                >
                  <PanelRightOpen size={17} />
                </button>
                <button
                  className="collapsed-compile"
                  data-running={build.running ? 'true' : undefined}
                  aria-label={build.running ? 'Cancel build' : 'Compile active document'}
                  title={
                    build.running
                      ? 'Cancel build'
                      : !canCompile
                        ? 'Open a .tex document to compile it.'
                        : 'Compile with ' + engine + ' (Ctrl+Enter)'
                  }
                  disabled={!build.running && (!canCompile || busy)}
                  onClick={() =>
                    build.running
                      ? void run(async () => {
                          unwrap(await window.textra.cancelBuild());
                        })
                      : void compile()
                  }
                >
                  {build.running ? (
                    <Square size={11} weight="fill" />
                  ) : (
                    <Play size={12} weight="fill" />
                  )}
                </button>
                <button
                  className="icon-button small"
                  aria-label="Show PDF preview"
                  title="Show PDF preview"
                  onClick={() => {
                    setPanel('preview');
                    updatePreferences({ previewVisible: true });
                  }}
                >
                  <FilePdf size={17} />
                </button>
                <button
                  className="icon-button small collapsed-alert"
                  data-severity={issueSeverity}
                  aria-label={'Show problems' + (issueCount ? ` (${issueCount})` : '')}
                  title={
                    issueSeverity === 'error'
                      ? `${errorCount} error${errorCount === 1 ? '' : 's'}`
                      : issueSeverity === 'warning'
                        ? `${warningCount} warning${warningCount === 1 ? '' : 's'}`
                        : issueSeverity === 'ok'
                          ? 'No problems'
                          : 'Show problems'
                  }
                  onClick={() => {
                    setPanel('problems');
                    updatePreferences({ previewVisible: true });
                  }}
                >
                  <span className="alert-glyph">
                    <Warning
                      size={17}
                      weight={
                        issueSeverity === 'error' || issueSeverity === 'warning' ? 'fill' : 'light'
                      }
                    />
                    {issueSeverity === 'ok' && (
                      <Check size={9} weight="bold" className="alert-check" />
                    )}
                  </span>
                </button>
                <button
                  className="icon-button small"
                  aria-label="Show build output"
                  title="Show build output"
                  onClick={() => {
                    setPanel('output');
                    updatePreferences({ previewVisible: true });
                  }}
                >
                  <Scroll size={17} />
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
      {fileMenu && project && (
        <div
          className="file-menu"
          ref={fileMenuRef}
          role="menu"
          tabIndex={-1}
          aria-label={'Actions for ' + (fileMenu.path || project.name)}
          style={{ left: fileMenu.x, top: fileMenu.y }}
          onKeyDown={(event) => {
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            );
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'Escape') {
              event.preventDefault();
              setFileMenu(null);
              fileMenuTrigger.current?.focus();
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              buttons[
                (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length
              ]?.focus();
            }
            if (event.key === 'Tab') setFileMenu(null);
          }}
        >
          <div className="file-menu-name">{fileMenu.path.split('/').at(-1) || project.name}</div>
          <button
            role="menuitem"
            disabled={busy || build.running || fileMenu.path === ''}
            onClick={() => {
              setFileMenu(null);
              rename();
            }}
          >
            Rename
          </button>
          <button
            role="menuitem"
            disabled={busy || build.running || fileMenu.path === ''}
            onClick={() => {
              setFileMenu(null);
              remove();
            }}
          >
            Delete
          </button>
          <button
            role="menuitem"
            disabled={busy}
            onClick={() => {
              const path = fileMenu.path;
              setFileMenu(null);
              void run(async () => {
                unwrap(await window.textra.revealEntry({ projectId: project.id, path }));
              });
            }}
          >
            Open in File Explorer
          </button>
          <button
            role="menuitem"
            disabled={busy}
            onClick={() => {
              const path = fileMenu.path;
              setFileMenu(null);
              void run(async () => {
                unwrap(await window.textra.openInCode({ projectId: project.id, path }));
              });
            }}
          >
            Open in VS Code
          </button>
          {([false, true] as const).map((relative) => (
            <button
              key={String(relative)}
              role="menuitem"
              disabled={busy}
              onClick={() => {
                const path = fileMenu.path;
                setFileMenu(null);
                void run(async () => {
                  unwrap(
                    await window.textra.copyEntryPath({ projectId: project.id, path, relative }),
                  );
                });
              }}
            >
              {relative ? 'Copy Relative Path' : 'Copy Path'}
            </button>
          ))}
        </div>
      )}
      <Dialog.Root open={!!formatPreview} onOpenChange={(open) => !open && setFormatPreview(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="action-dialog format-preview-dialog">
            <Dialog.Title>Format preview</Dialog.Title>
            <Dialog.Description>
              latexindent generated a proposed rewrite. Review it before replacing your open buffer.
            </Dialog.Description>
            <pre className="format-preview-source">{formatPreview?.content}</pre>
            <div className="dialog-actions">
              <button onClick={() => setFormatPreview(null)}>Discard</button>
              <button
                className="primary-button"
                onClick={() => {
                  if (formatPreview) editDocument(formatPreview.path, formatPreview.content);
                  setFormatPreview(null);
                }}
              >
                Apply formatted text
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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
