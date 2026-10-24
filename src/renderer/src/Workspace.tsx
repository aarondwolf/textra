import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { ReviewOutcomeEvent } from './features/chat/ChatPanel';
import { lazyFeature } from './features/startup/LazyFeature';
import { afterPaint, markStartup, scheduleBackground } from './features/startup/scheduling';
import { persistWorkspaceSession, restoreWorkspaceSession } from './features/startup/session';
import { useStartup } from './state/startup';
import { loadAISettings } from './features/chat/useAISettings';
import { CompileControl, ProblemsButton } from './components/CompileControl';
import { agentEditHunks } from '../../shared/ai-edits';
import { AGENT_SOURCE_LIMIT, type AIAgentContext, type AIEditProposal } from '../../shared/ai';
import {
  AIChat,
  ArrowSquareOut,
  ArrowsInSimple,
  ArrowsOutSimple,
  BracketsCurly,
  Check,
  ChevronRight,
  Copy,
  Columns2,
  Broom,
  ChevronDown,
  Settings,
  Ellipsis,
  Files,
  FilePlus2,
  FileText,
  Folder,
  History,
  Hammer,
  FolderOpen,
  FolderPlus,
  FilePdf,
  MarkdownLogo,
  Scroll,
  Warning,
  Pencil,
  Save,
  TextraLogo,
  VSCodeIcon,
  X,
} from './icons';
import { FileIcon } from './features/files/FileIcon';
import { DropdownMenu } from './components/DropdownMenu';
import {
  BUILD_RECIPES,
  DEFAULT_PREFERENCES,
  SIDEBAR_WIDTH_RANGE,
  type BuildEngine,
  type ExternalFileChangeEvent,
  type HistorySnapshotSummary,
  type ProjectConfig,
  type Result,
  type RestoredPdf,
  type TexlabStatus,
} from '../../shared/api';
import { useUI } from './state/ui';
import { flushWorkspacePersistence } from './state/shutdown';
import {
  applyFormatting,
  prepareFormatting,
  restoreHistoryDocument,
  type FormattingPreview,
} from './state/document-actions';
import { runLanguageRequest } from './state/language-requests';
import { validateRecipeSettings } from '../../shared/recipes';
import {
  checkExternalChanges,
  closeDocument,
  selectDocument,
  dirty,
  discardAll,
  editDocument,
  initializeWorkspace,
  discoverWorkspaceTools,
  cancelWorkspaceRestoration,
  markExternalChange,
  openDocument,
  reorderDocuments,
  saveAll,
  saveDocument,
  setProject,
  showError,
  useWorkspace,
} from './state/workspace';
import type { ExternalChangeStatus } from './features/conflicts/types';
import type { TexlabDiagnostic } from './features/editor/SourceEditor';
import { createTexlabAdapter, texlabMarkers } from './features/editor/texlabAdapter';
import { notify } from './features/notifications/ToastViewport';
import type { ProblemDiagnostic } from './features/problems/ProblemsPanel';
import type { SectionId } from './features/onboarding/SetupDialog';
import { useProjectAnalysis } from './features/writing/useProjectAnalysis';
import { IconButton } from './components/Button';
import { PaneHeader } from './components/Layout';
import { extractPromptContext, moveSectionInLatex } from '../../shared/writing-analysis';

const loadSourceEditor = () =>
  import('./features/editor/SourceEditor').then((module) => ({ default: module.SourceEditor }));
const SourceEditor = lazyFeature(loadSourceEditor, 'Editor');
const ChatPanel = lazyFeature<ComponentProps<typeof import('./features/chat/ChatPanel').ChatPanel>>(
  () => import('./features/chat/ChatPanel').then((module) => ({ default: module.ChatPanel })),
  'Assistant',
);
const AgentInlineReview = lazyFeature<
  ComponentProps<typeof import('./features/chat/AgentInlineReview').AgentInlineReview>
>(
  () =>
    import('./features/chat/AgentInlineReview').then((module) => ({
      default: module.AgentInlineReview,
    })),
  'Edit review',
);
const AgentReviewControls = lazyFeature<
  ComponentProps<typeof import('./features/chat/AgentInlineReview').AgentReviewControls>
>(
  () =>
    import('./features/chat/AgentInlineReview').then((module) => ({
      default: module.AgentReviewControls,
    })),
  'Review controls',
);
const ConflictDialog = lazyFeature<
  ComponentProps<typeof import('./features/conflicts/ConflictDialog').ConflictDialog>
>(
  () =>
    import('./features/conflicts/ConflictDialog').then((module) => ({
      default: module.ConflictDialog,
    })),
  'Conflict decision',
);
const ConflictDiffView = lazyFeature<
  ComponentProps<typeof import('./features/conflicts/ConflictDiffView').ConflictDiffView>
>(
  () =>
    import('./features/conflicts/ConflictDiffView').then((module) => ({
      default: module.ConflictDiffView,
    })),
  'Comparison',
);
const PdfViewer = lazyFeature(() => import('./features/pdf/PdfViewer'), 'PDF preview');
const MarkdownPreview = lazyFeature<
  ComponentProps<typeof import('./features/markdown/MarkdownPreview').MarkdownPreview>
>(
  () =>
    import('./features/markdown/MarkdownPreview').then((module) => ({
      default: module.MarkdownPreview,
    })),
  'Markdown preview',
);
const SnippetPalette = lazyFeature(() => import('./features/snippets/SnippetPalette'), 'Snippets');
const ProblemsPanel = lazyFeature<
  ComponentProps<typeof import('./features/problems/ProblemsPanel').ProblemsPanel>
>(
  () =>
    import('./features/problems/ProblemsPanel').then((module) => ({
      default: module.ProblemsPanel,
    })),
  'Problems',
);
const WritingPanel = lazyFeature<
  ComponentProps<typeof import('./features/writing/WritingPanel').WritingPanel>
>(
  () =>
    import('./features/writing/WritingPanel').then((module) => ({ default: module.WritingPanel })),
  'Writing tools',
);
const CompileRecipeEditor = lazyFeature<
  ComponentProps<typeof import('./features/compile/CompileRecipeEditor').CompileRecipeEditor>
>(
  () =>
    import('./features/compile/CompileRecipeEditor').then((module) => ({
      default: module.CompileRecipeEditor,
    })),
  'Recipe editor',
);
const HistoryDiffView = lazyFeature<
  ComponentProps<typeof import('./features/history').HistoryDiffView>
>(
  () =>
    import('./features/history').then((module) => ({
      default: module.HistoryDiffView,
    })),
  'History comparison',
);
const HistoryPanel = lazyFeature<ComponentProps<typeof import('./features/history').HistoryPanel>>(
  () =>
    import('./features/history').then((module) => ({
      default: module.HistoryPanel,
    })),
  'File history',
);

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

function projectFileUri(rootPath: string | undefined, relativePath: string): string | undefined {
  if (!rootPath) return undefined;
  const absolute = `${rootPath.replace(/\\/g, '/')}/${relativePath}`.replace(/\/+/g, '/');
  // POSIX roots already start with "/"; a fourth slash makes Monaco reject the URI.
  return `file:///${encodeURI(absolute.replace(/^\/+/, ''))}`;
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

export function Workspace({ onOpenSettings }: { onOpenSettings?: (section?: SectionId) => void }) {
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
    projectConfig,
    configReady,
    error,
    busy,
  } = state;
  const {
    preferences,
    hydrated,
    updatePreferences,
    panel,
    setPanel,
    expandedPane: requestedPane,
    setExpandedPane,
  } = useUI();
  const projectId = project?.id;
  const [resourceEpoch, setResourceEpoch] = useState(0);
  useEffect(() => window.textra.onCloseCancelled(() => setResourceEpoch((epoch) => epoch + 1)), []);
  const treeState = project?.treeState;
  const editorReady = useStartup((state) => state.editorReady);
  const restoration = useStartup((state) => state.restoration);
  const coreReady = editorReady || (hydrated && restoration === 'settled' && !activePath);
  useEffect(() => {
    void afterPaint().then(() => markStartup('shell-visible'));
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    if (preferences.restoreSession) void restoreWorkspaceSession();
    else cancelWorkspaceRestoration();
  }, [hydrated, preferences.restoreSession]);
  const sessionTabs = documents.map((document) => document.path).join('\0');
  useEffect(() => {
    persistWorkspaceSession(preferences.restoreSession);
  }, [sessionTabs, activePath, project?.id, recents, preferences.restoreSession, restoration]);
  useEffect(() => {
    if (projectId) void loadSourceEditor().catch(() => undefined);
  }, [projectId]);
  useEffect(() => {
    if (!coreReady) return;
    return scheduleBackground(() => {
      void discoverWorkspaceTools();
      void loadAISettings()
        .then(() => window.textra.prepareAI())
        .catch(() => undefined);
    });
  }, [coreReady]);
  useEffect(() => {
    if (!projectId || !coreReady || !configReady) return;
    const id = projectId;
    return scheduleBackground(() => {
      void window.textra.prepareProject(id).catch(() => undefined);
    });
  }, [projectId, coreReady, configReady]);
  useEffect(() => {
    if (!projectId || treeState !== 'loading' || !coreReady) return;
    const id = projectId;
    let cancelled = false;
    const cancel = scheduleBackground(() => {
      void window.textra
        .refreshProject(id)
        .then((result) => {
          if (!cancelled && useWorkspace.getState().project?.id === id && result.ok)
            useWorkspace.setState({ project: result.value });
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      cancel();
    };
  }, [projectId, treeState, coreReady]);
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
  type SidebarView =
    'explorer' | 'writing' | 'equations' | 'snippets' | 'compile' | 'recents' | 'chat' | 'history';
  const [sidebarView, setSidebarView] = useState<SidebarView>('explorer');
  const [historyDiff, setHistoryDiff] = useState<{
    snapshot: HistorySnapshotSummary;
    historicalContent: string;
  } | null>(null);
  const [chatOpened, setChatOpened] = useState(false);
  const [chatDraft, setChatDraft] = useState<{
    id: number;
    text: string;
    projectId: string | null;
    autoSend?: boolean;
  } | null>(null);
  const chatDraftId = useRef(0);
  useEffect(() => {
    setChatDraft(null);
  }, [project?.id]);
  const [fileFilter, setFileFilter] = useState('');
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [pdfPreviewPath, setPdfPreviewPath] = useState<string | null>(null);
  const [restoredPdf, setRestoredPdf] = useState<RestoredPdf | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  useEffect(() => {
    if ((coreReady && preferences.previewVisible) || pdfPreviewPath) setPreviewLoaded(true);
  }, [coreReady, preferences.previewVisible, pdfPreviewPath]);
  useEffect(() => {
    setRestoredPdf(null);
    if (!projectId || !coreReady) return;
    let cancelled = false;
    const id = projectId;
    void window.textra
      .restoreLastPdf(id)
      .then((result) => {
        const current = useWorkspace.getState();
        if (
          !cancelled &&
          result.ok &&
          current.project?.id === id &&
          !(current.build.projectId === id && current.build.outcome === 'success')
        )
          setRestoredPdf(result.value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, coreReady]);
  useEffect(() => {
    if (build.projectId === project?.id && build.outcome === 'success') setRestoredPdf(null);
  }, [build.projectId, build.outcome, project?.id]);
  const [savedTabPath, setSavedTabPath] = useState<string | null>(null);
  const savedTabTimer = useRef<number | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    index: number;
  } | null>(null);

  useEffect(() => {
    if (!tabContextMenu) return;
    const dismiss = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.tab-context-menu')) return;
      setTabContextMenu(null);
    };
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, [tabContextMenu]);

  const closeOtherTabs = (keepPath: string) => {
    const toClose = documents.filter((d) => d.path !== keepPath);
    for (const doc of toClose) {
      if (dirty(doc)) protect(async () => closeDocument(doc.path));
      else closeDocument(doc.path);
    }
  };

  const closeTabsToTheRight = (index: number) => {
    const toClose = documents.slice(index + 1);
    for (const doc of toClose) {
      if (dirty(doc)) protect(async () => closeDocument(doc.path));
      else closeDocument(doc.path);
    }
  };

  const closeSavedTabs = () => {
    const toClose = documents.filter((d) => !dirty(d));
    for (const doc of toClose) {
      closeDocument(doc.path);
    }
  };
  type BuildFeedback = 'idle' | 'success' | 'failed';
  const [buildFeedback, setBuildFeedback] = useState<BuildFeedback>('idle');
  const wasRunning = useRef(false);

  useEffect(() => {
    if (wasRunning.current && !build.running) {
      if (build.outcome === 'success') {
        setBuildFeedback('success');
        const timer = window.setTimeout(() => setBuildFeedback('idle'), 2500);
        return () => window.clearTimeout(timer);
      } else if (build.outcome === 'failed') {
        setBuildFeedback('failed');
        const timer = window.setTimeout(() => setBuildFeedback('idle'), 3500);
        return () => window.clearTimeout(timer);
      }
    } else if (build.running) {
      setBuildFeedback('idle');
    }
    wasRunning.current = build.running;
  }, [build.running, build.outcome]);
  const [lintDiagnostics, setLintDiagnostics] = useState<ProblemDiagnostic[]>([]);
  const [texlabStatus, setTexlabStatus] = useState<TexlabStatus | null>(null);
  const [texlabDiagnostics, setTexlabDiagnostics] = useState<
    ReadonlyMap<string, readonly TexlabDiagnostic[]>
  >(new Map());
  const [texlabProblemDiagnostics, setTexlabProblemDiagnostics] = useState<
    ReadonlyMap<string, readonly ProblemDiagnostic[]>
  >(new Map());
  const [formatPreview, setFormatPreview] = useState<FormattingPreview | null>(null);
  const [conflictPath, setConflictPath] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState<ExternalFileChangeEvent | null>(null);
  const [conflictSnapshotPath, setConflictSnapshotPath] = useState<string | undefined>();
  const [comparison, setComparison] = useState<{
    path: string;
    localContent: string;
    externalContent: string | null;
  } | null>(null);
  const [compareWhenStable, setCompareWhenStable] = useState(false);
  useEffect(() => {
    const isDiffActive = Boolean(
      (comparison && comparison.path === activePath) ||
      (historyDiff && historyDiff.snapshot.path === activePath),
    );
    if (isDiffActive && preferences.previewVisible) {
      updatePreferences({ previewVisible: false });
    }
  }, [comparison, historyDiff, activePath, preferences.previewVisible, updatePreferences]);
  const watchedDocumentRefs = useMemo(
    () => documents.map(({ projectId, path }) => ({ projectId, path })),
    // Editing changes document objects but must not tear down and recreate their filesystem watches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [documents.map((document) => `${document.projectId}\u0000${document.path}`).join('\n')],
  );
  useEffect(() => {
    let active = true;
    setTexlabDiagnostics(new Map());
    setTexlabProblemDiagnostics(new Map());
    if (!coreReady || !preferences.texlabEnabled) return;
    void window.textra.getTexlabStatus().then((result) => {
      if (active && result.ok) setTexlabStatus(result.value);
    });
    return () => {
      active = false;
    };
  }, [coreReady, preferences.texlabEnabled, project?.id]);
  const texlabAdapter = useMemo(() => {
    const adapter = createTexlabAdapter({
      resourceEpoch,
      documents,
      ready:
        preferences.texlabEnabled &&
        (texlabStatus?.installation === 'managed' || texlabStatus?.installation === 'external'),
      diagnostics: texlabDiagnostics,
      onDiagnostics: (path, next) => {
        setTexlabDiagnostics((current) => {
          const updated = new Map(current);
          updated.set(path, texlabMarkers(next));
          return updated;
        });
        setTexlabProblemDiagnostics((current) => {
          const updated = new Map(current);
          updated.set(path, next);
          return updated;
        });
      },
    });
    const rootPath = project?.rootPath;
    return {
      ...adapter,
      documentUri: (document: { path: string }) =>
        projectFileUri(rootPath, document.path) ?? `inmemory://textra/${document.path}`,
    };
  }, [
    resourceEpoch,
    documents,
    preferences.texlabEnabled,
    project?.rootPath,
    texlabDiagnostics,
    texlabStatus?.installation,
  ]);
  /** Clicking the icon of the view that is already showing collapses the sidebar. */
  function selectSidebarView(view: SidebarView) {
    if (view === 'chat') setChatOpened(true);
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
  }, [project?.id]);
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
  function openExplorerFile(path: string) {
    if (path.toLowerCase().endsWith('.pdf')) {
      setPdfPreviewPath(path);
      setPanel('preview');
      useUI.getState().setExpandedPane(null);
      if (!preferences.previewVisible) {
        void updatePreferences({ previewVisible: true });
      }
      return;
    }
    const replaceCandidate =
      preferences.previewTabs && previewPath && previewPath !== path ? previewPath : null;
    const previous = replaceCandidate
      ? documents.find((document) => document.path === replaceCandidate)
      : null;
    const shouldReplace = previous && !dirty(previous);
    setPreviewPath(preferences.previewTabs ? path : null);
    if (/\.md(?:own)?$/i.test(path)) {
      setPanel('markdown');
    }
    void openDocument(path, undefined, {
      replacePath: shouldReplace ? previous.path : undefined,
    });
  }
  useEffect(() => {
    if (!previewPath) return;
    const preview = documents.find((document) => document.path === previewPath);
    if (!preview || dirty(preview)) setPreviewPath(null);
  }, [documents, previewPath]);
  const visibleFiles =
    project?.files.filter(
      (file) =>
        (!fileFilter || file.path.toLowerCase().includes(fileFilter.trim().toLowerCase())) &&
        !file.path
          .split('/')
          .slice(0, -1)
          .some((_, index, parts) => !expandedFolders.has(parts.slice(0, index + 1).join('/'))),
    ) ?? [];
  const { fontSize, wrap, formatToolbarVisible } = preferences;
  const setFontSize = (size: number) => updatePreferences({ fontSize: size });
  const setWrap = (value: boolean) => updatePreferences({ wrap: value });
  const split = useRef<HTMLDivElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const buildStartedAt = useRef<number | null>(null);
  const polling = useRef(false);
  const operations = useRef(0);
  const active = documents.find((document) => document.path === activePath);
  const hasMarkdown = Boolean(
    (activePath && /\.md(?:own)?$/i.test(activePath)) ||
    documents.some((document) => /\.md(?:own)?$/i.test(document.path)),
  );
  const activeMarkdownDoc =
    active && /\.md(?:own)?$/i.test(active.path)
      ? active
      : documents.find((document) => /\.md(?:own)?$/i.test(document.path));

  useEffect(() => {
    if (!hasMarkdown && panel === 'markdown') {
      setPanel('preview');
    }
  }, [hasMarkdown, panel, setPanel]);

  const previousActivePathRef = useRef<string | null>(null);
  useEffect(() => {
    if (activePath && activePath !== previousActivePathRef.current) {
      if (/\.md(?:own)?$/i.test(activePath)) {
        setPanel('markdown');
      }
    }
    previousActivePathRef.current = activePath;
  }, [activePath, setPanel]);
  const [agentContext, setAgentContext] = useState<AIAgentContext | null>(null);
  const [agentWorking, setAgentWorking] = useState(false);
  const [agentAccessNeeded, setAgentAccessNeeded] = useState(false);
  const [agentProposal, setAgentProposal] = useState<AIEditProposal | null>(null);
  const agentApprovedSnapshot = useRef<Pick<
    AIEditProposal,
    'projectId' | 'path' | 'modified'
  > | null>(null);
  const [agentReviewBusy, setAgentReviewBusy] = useState(false);
  const [agentReviewError, setAgentReviewError] = useState<string | null>(null);
  const agentReviewRunning = useRef(false);
  const agentHunks = useMemo(
    () => (agentProposal ? agentEditHunks(agentProposal.content, agentProposal.modified) : []),
    [agentProposal],
  );
  // Application-owned review tally, reported back to the assistant conversation as context.
  const agentReviewTally = useRef({ approved: 0, rejected: 0 });
  const reviewOutcomeId = useRef(0);
  const [reviewOutcome, setReviewOutcome] = useState<ReviewOutcomeEvent | null>(null);
  function finishAgentReview() {
    const { approved, rejected } = agentReviewTally.current;
    agentReviewTally.current = { approved: 0, rejected: 0 };
    setReviewOutcome({
      id: ++reviewOutcomeId.current,
      outcome: approved && !rejected ? 'applied' : approved ? 'partial' : 'rejected',
    });
  }
  function reviewAgentProposal(proposal: AIEditProposal) {
    agentReviewTally.current = { approved: 0, rejected: 0 };
    agentApprovedSnapshot.current = null;
    setAgentReviewError(null);
    setAgentProposal(proposal);
  }
  async function runAgentReview(action: () => Promise<void>) {
    if (agentReviewRunning.current) return;
    agentReviewRunning.current = true;
    setAgentReviewBusy(true);
    setAgentReviewError(null);
    try {
      await action();
    } catch (cause) {
      setAgentReviewError(
        cause instanceof Error ? cause.message : 'Could not complete the review action.',
      );
    } finally {
      agentReviewRunning.current = false;
      setAgentReviewBusy(false);
    }
  }
  const hadAgentContext = useRef(false);
  const agentReviewActive = agentProposal !== null;
  const agentProjectId = active?.projectId;
  const agentPath = active?.path;
  const agentContent = active?.content;
  const agentRevision = active?.revision;
  const agentConflict = active?.conflict;
  const synchronizeAgentDocument = agentAccessNeeded || agentReviewActive || agentWorking;
  useEffect(() => {
    let current = true;
    setAgentContext(null);
    const snapshot =
      synchronizeAgentDocument &&
      agentProjectId &&
      agentPath &&
      agentContent !== undefined &&
      agentRevision &&
      !agentConflict &&
      !busy &&
      /\.tex$/i.test(agentPath) &&
      agentContent.length <= AGENT_SOURCE_LIMIT
        ? {
            projectId: agentProjectId,
            path: agentPath,
            content: agentContent,
            revision: agentRevision,
          }
        : null;
    if (!snapshot && !hadAgentContext.current) return;
    hadAgentContext.current = snapshot !== null;
    void window.textra
      .syncAIAgentDocument(snapshot)
      .then((result) => {
        if (current && result.ok) setAgentContext(result.value);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [
    synchronizeAgentDocument,
    agentProjectId,
    agentPath,
    agentContent,
    agentRevision,
    agentConflict,
    busy,
  ]);
  useEffect(
    () => () => {
      void window.textra.syncAIAgentDocument(null);
    },
    [],
  );
  const agentInvalidReason =
    agentProposal &&
    (busy ||
      !active ||
      active.conflict ||
      // A review decision rotates the main-owned opaque context. The renderer may still be
      // catching up on its matching sync request; main validates the proposal context on click.
      active.projectId !== agentProposal.projectId ||
      active.path !== agentProposal.path ||
      active.content !== agentProposal.content ||
      active.revision !== agentProposal.revision)
      ? 'The active file changed. Reject this proposal and ask again using the current file.'
      : null;
  async function saveApprovedAgentBuffer() {
    const approved = agentApprovedSnapshot.current;
    agentApprovedSnapshot.current = null;
    if (!approved || !useUI.getState().preferences.autoSave) return;
    const workspace = useWorkspace.getState();
    const document = workspace.documents.find((item) => item.path === approved.path);
    if (
      !workspace.busy &&
      workspace.project?.id === approved.projectId &&
      document?.projectId === approved.projectId &&
      !document.conflict &&
      document.content === approved.modified &&
      document.savedContent !== document.content
    )
      await saveDocument(approved.path);
  }
  async function decideAgentHunks(approveHunkIds: string[], rejectHunkIds: string[]) {
    const proposal = agentProposal;
    if (!proposal || agentInvalidReason) throw new Error('This proposal is no longer current.');
    const result = unwrap(
      await window.textra.reviewAIAgentProposal({
        id: proposal.id,
        contextId: proposal.contextId,
        approveHunkIds,
        rejectHunkIds,
      }),
    );
    try {
      const workspace = useWorkspace.getState();
      const document = workspace.documents.find((item) => item.path === workspace.activePath);
      if (
        workspace.busy ||
        !document ||
        document.conflict ||
        document.projectId !== proposal.projectId ||
        document.path !== proposal.path ||
        document.content !== proposal.content ||
        document.revision !== proposal.revision
      )
        throw new Error(
          'The active file changed while approving. Ask again using the current file.',
        );
      if (result.applied) {
        if (preferences.historyEnabled && proposal.projectId) {
          void window.textra
            .createFileHistorySnapshot({
              projectId: proposal.projectId,
              path: proposal.path,
              content: proposal.content,
              trigger: 'ai',
              force: true,
              label: 'Pre-AI review changes',
            })
            .then(() => window.dispatchEvent(new CustomEvent('textra:history:updated')))
            .catch(() => undefined);
        }
        const event = new CustomEvent('textra:apply-agent-edit', {
          detail: result.applied,
          cancelable: true,
        });
        if (window.dispatchEvent(event))
          throw new Error('The active editor could not apply this proposal.');
        agentApprovedSnapshot.current = result.applied;
        agentReviewTally.current.approved += approveHunkIds.length;
      }
      agentReviewTally.current.rejected += rejectHunkIds.length;
    } catch (cause) {
      agentReviewTally.current.rejected += 1;
      finishAgentReview();
      if (result.remaining)
        await window.textra.rejectAIAgentProposal(result.remaining.id).catch(() => undefined);
      setAgentProposal(null);
      agentApprovedSnapshot.current = null;
      const workspace = useWorkspace.getState();
      const current = workspace.documents.find((item) => item.path === workspace.activePath);
      const snapshot =
        current &&
        !current.conflict &&
        !workspace.busy &&
        /\.tex$/i.test(current.path) &&
        current.content.length <= AGENT_SOURCE_LIMIT
          ? {
              projectId: current.projectId,
              path: current.path,
              content: current.content,
              revision: current.revision,
            }
          : null;
      const synced = await window.textra.syncAIAgentDocument(snapshot).catch(() => null);
      const latest = useWorkspace.getState();
      const latestDocument = latest.documents.find((item) => item.path === latest.activePath);
      if (
        latest.project?.id === workspace.project?.id &&
        latest.activePath === workspace.activePath &&
        latest.busy === workspace.busy &&
        latestDocument?.projectId === current?.projectId &&
        latestDocument?.path === current?.path &&
        latestDocument?.content === current?.content &&
        latestDocument?.revision === current?.revision &&
        latestDocument?.conflict === current?.conflict
      )
        setAgentContext(synced?.ok ? synced.value : null);
      window.dispatchEvent(
        new CustomEvent('textra:notify', {
          detail: {
            message:
              'The file changed during review. Your current text is safe; ask again to review fresh changes.',
            tone: 'error',
          },
        }),
      );
      throw cause;
    }
    setAgentContext(result.context);
    setAgentProposal(result.remaining);
    if (!result.remaining) {
      finishAgentReview();
      await saveApprovedAgentBuffer();
    }
  }
  async function rejectAgentProposal() {
    if (agentProposal) unwrap(await window.textra.rejectAIAgentProposal(agentProposal.id));
    if (agentProposal) {
      agentReviewTally.current.rejected += Math.max(1, agentHunks.length);
      finishAgentReview();
    }
    setAgentProposal(null);
    await saveApprovedAgentBuffer();
  }
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
  const canCompile = configReady && !!active && /\.tex$/i.test(active.path);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const recipeControl = useRef<HTMLDivElement>(null);
  const [pdfSlot, setPdfSlot] = useState<HTMLDivElement | null>(null);
  const [headerNode, setHeaderNode] = useState<HTMLDivElement | null>(null);
  const [headerCompact, setHeaderCompact] = useState(false);
  const [logCopied, setLogCopied] = useState(false);
  const [tabsHost, setTabsHost] = useState<HTMLDivElement | null>(null);
  const [tabMode, setTabMode] = useState<'full' | 'icons' | 'menu'>('full');
  const [pdfMenuSlot, setPdfMenuSlot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!tabsHost) return;
    // Hysteresis thresholds: buffer state transitions so rapid oscillation between icons and menu is prevented.
    const measure = () => {
      const width = tabsHost.clientWidth;
      const fullCollapse = hasMarkdown ? 310 : 250;
      const fullExpand = fullCollapse + 30;
      const iconsCollapse = hasMarkdown ? 155 : 125;
      const iconsExpand = iconsCollapse + 30;

      setTabMode((current) => {
        if (current === 'full') {
          if (width < fullCollapse) {
            return width < iconsCollapse ? 'menu' : 'icons';
          }
          return 'full';
        }
        if (current === 'icons') {
          if (width >= fullExpand) return 'full';
          if (width < iconsCollapse) return 'menu';
          return 'icons';
        }
        // current === 'menu'
        if (width >= fullExpand) return 'full';
        if (width >= iconsExpand) return 'icons';
        return 'menu';
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tabsHost);
    return () => observer.disconnect();
  }, [tabsHost, hasMarkdown]);
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
  const { analysisSources, bibliographyEntries, documentAnalysis, referenceDiagnostics } =
    useProjectAnalysis(project, documents, activePath, coreReady);
  const problemDiagnostics = useMemo<ProblemDiagnostic[]>(() => {
    const all = [
      ...(currentBuild?.diagnostics ?? []),
      ...lintDiagnostics,
      ...referenceDiagnostics,
      ...[...texlabProblemDiagnostics.values()].flat(),
    ];
    if (!activePath) return all;
    return all.filter((diagnostic) => {
      if (!diagnostic.file) return true;
      const diagFile = diagnostic.file.replace(/^[./\\]+/, '').toLowerCase();
      const activeNormalized = activePath.replace(/^[./\\]+/, '').toLowerCase();
      return (
        diagFile === activeNormalized ||
        diagFile.endsWith(`/${activeNormalized}`) ||
        activeNormalized.endsWith(`/${diagFile}`) ||
        diagFile.split(/[/\\]/).pop() === activeNormalized.split(/[/\\]/).pop()
      );
    });
  }, [
    activePath,
    currentBuild?.diagnostics,
    lintDiagnostics,
    referenceDiagnostics,
    texlabProblemDiagnostics,
  ]);
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
    if (!preferences.externalChangeDetection || !watchedDocumentRefs.length) return;
    for (const document of watchedDocumentRefs)
      void window.textra
        .watchExternalFile({
          ...document,
          pollingOnly: preferences.externalChangePollingOnly,
          quietPeriodMs: preferences.externalChangeQuietPeriodMs,
        })
        .then((result) => {
          if (!result.ok) showError(result.error);
        })
        .catch(showError);
    return () => {
      for (const document of watchedDocumentRefs) void window.textra.unwatchExternalFile(document);
    };
  }, [
    preferences.externalChangeDetection,
    preferences.externalChangePollingOnly,
    preferences.externalChangeQuietPeriodMs,
    watchedDocumentRefs,
    resourceEpoch,
  ]);
  useEffect(() => {
    if (!preferences.externalChangeDetection) return;
    return window.textra.onExternalFileChange((event) => {
      const current = useWorkspace.getState();
      if (
        current.project?.id !== event.projectId ||
        !current.documents.some((d) => d.path === event.path)
      )
        return;
      if (event.state === 'watching') return;
      markExternalChange(event.path, event.state);
      setExternalChange(event);
      setConflictPath((existing) => {
        if (existing) return existing;
        setConflictSnapshotPath(undefined);
        setComparison(null);
        setCompareWhenStable(false);
        return event.path;
      });
    });
  }, [preferences.externalChangeDetection]);
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
        ...(useUI.getState().preferences.externalChangeDetection ? [checkExternalChanges()] : []),
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
  useEffect(() => {
    if (build.running) {
      buildStartedAt.current ??= Date.now();
      return;
    }
    if (buildStartedAt.current === null || build.outcome === 'idle') return;
    buildStartedAt.current = null;
  }, [build.outcome, build.running]);

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
    cancelWorkspaceRestoration();
    protect(async () => {
      await flushWorkspacePersistence();
      const result = recentId
        ? await window.textra.openRecentProject(recentId)
        : await window.textra.chooseProject();
      const next = unwrap(result);
      if (next) {
        void setProject(next).catch(showError);
        setSelected(null);
      }
    });
  }
  function generateWorkspace() {
    if (build.running) {
      showError('Cancel the running build before generating a workspace.');
      return;
    }
    cancelWorkspaceRestoration();
    protect(async () => {
      let targetProject = project;
      if (!targetProject) {
        await flushWorkspacePersistence();
        const result = await window.textra.chooseProject();
        const next = unwrap(result);
        if (!next) return;
        targetProject = next;
        await setProject(next);
      }

      // Ensure .textra folder exists
      await window.textra.prepareProject(targetProject.id);

      // Inspect existing settings; only set default values for properties that have not yet been set
      const existingConfigResult = await window.textra.getProjectConfig(targetProject.id);
      const existing = existingConfigResult.ok
        ? existingConfigResult.value
        : ({} as Partial<ProjectConfig>);

      const mergedConfig: ProjectConfig = {
        ...existing,
        schemaVersion: existing.schemaVersion ?? 1,
        rootFile: existing.rootFile ?? 'main.tex',
        engine: existing.engine ?? 'pdflatex',
      };

      await window.textra.setProjectConfig({
        projectId: targetProject.id,
        config: mergedConfig,
      });

      const currentProject = useWorkspace.getState().project ?? targetProject;
      const fileToOpen = mergedConfig.rootFile || 'main.tex';

      const mainTexContent = [
        '\\documentclass{article}',
        '',
        '\\begin{document}',
        '',
        'Hello, World!',
        '',
        '\\end{document}',
        '',
      ].join('\n');

      const fileExists = currentProject.files.some((file) => file.path === fileToOpen);
      if (!fileExists) {
        const createResult = await window.textra.createEntry({
          projectId: currentProject.id,
          path: fileToOpen,
          kind: 'file',
          content: mainTexContent,
        });
        if (createResult.ok) {
          useWorkspace.setState({ project: createResult.value });
        }
      }

      setSelected(fileToOpen);
      updatePreferences({ sidebarVisible: true });
      setSidebarView('explorer');
      await openDocument(fileToOpen);
    });
  }
  async function refresh() {
    if (!project) return;
    const refreshed = unwrap(await window.textra.refreshProject(project.id));
    if (useWorkspace.getState().project?.id === project.id)
      useWorkspace.setState({ project: refreshed });
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
    if (useWorkspace.getState().project?.id !== project.id) return;
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
        if (useWorkspace.getState().project?.id !== project.id) return;
        useWorkspace.setState({ project: next });
        await openDocument(path);
      },
    });
  }
  function duplicateEntry() {
    if (!project || !selected) return;
    const sourcePath = selected;
    const source = project.files.find((file) => file.path === sourcePath);
    if (!source || source.kind !== 'file') return;
    const suggested = sourcePath.replace(/(\.[^/.]+)?$/, '-copy$1');
    setPrompt({
      title: 'Duplicate file',
      detail: `Create a separate copy of ${sourcePath}. The original will not change.`,
      initial: suggested,
      action: 'Create copy',
      run: async (path) => {
        const snapshot = unwrap(
          await window.textra.readFile({ projectId: project.id, path: sourcePath }),
        );
        const next = unwrap(
          await window.textra.createEntry({
            projectId: project.id,
            path,
            kind: 'file',
            content: snapshot.content,
          }),
        );
        useWorkspace.setState({ project: next });
        await openDocument(path);
      },
    });
  }
  const conflictedDocument = conflictPath
    ? (documents.find((document) => document.path === conflictPath) ?? null)
    : null;
  const externalStatus: ExternalChangeStatus = {
    state:
      externalChange?.state === 'deleted'
        ? 'missing'
        : externalChange?.state === 'renamed'
          ? 'renamed'
          : externalChange?.state === 'stable'
            ? 'stable'
            : 'changing',
    quietPeriodMs: preferences.externalChangeQuietPeriodMs,
    detail:
      externalChange?.state === 'deleted'
        ? 'The file was deleted outside TeXtra. Your open text is still safe in memory.'
        : externalChange?.state === 'renamed'
          ? 'The file was renamed or replaced outside TeXtra. Your open text is still safe in memory.'
          : undefined,
  };
  const refreshConflictComparison = useCallback(
    async (path = conflictPath): Promise<void> => {
      if (!project || !path) return;
      const result = await window.textra.readFile({ projectId: project.id, path });
      if (useWorkspace.getState().project?.id !== project.id) return;
      const current = useWorkspace.getState().documents.find((document) => document.path === path);
      if (!current) return;
      if (preferences.previewVisible) {
        updatePreferences({ previewVisible: false });
      }
      if (!result.ok) {
        setComparison({ path, localContent: current.content, externalContent: null });
        selectDocument(path);
        return;
      }
      setComparison({ path, localContent: current.content, externalContent: result.value.content });
      selectDocument(path);
    },
    [conflictPath, project, preferences.previewVisible, updatePreferences],
  );
  async function preserveConflictCopy(compare: boolean): Promise<void> {
    if (!conflictedDocument) return;
    const result = await window.textra.createConflictCopy({
      projectId: conflictedDocument.projectId,
      path: conflictedDocument.path,
      content: conflictedDocument.content,
    });
    if (!result.ok) throw new Error(result.error);
    if (useWorkspace.getState().project?.id !== conflictedDocument.projectId) return;
    setConflictSnapshotPath(result.value.path);
    const projectInfo = await window.textra.refreshProject(conflictedDocument.projectId);
    if (useWorkspace.getState().project?.id !== conflictedDocument.projectId) return;
    if (projectInfo.ok) useWorkspace.setState({ project: projectInfo.value });
    await openDocument(result.value.path);
    notify(`Saved ${result.value.path}`, 'success');
    const shouldCompare = compare || preferences.openDiffAfterConflictCopy;
    if (shouldCompare) {
      setCompareWhenStable(true);
      if (externalStatus.state === 'stable') {
        await refreshConflictComparison(conflictedDocument.path);
        setConflictPath(null);
        setCompareWhenStable(false);
      }
    } else {
      // A dated sibling copy is a complete recovery action, including after a
      // rename or deletion. Dismiss the modal so it cannot trap the user.
      setConflictPath(null);
      setExternalChange(null);
      setConflictSnapshotPath(undefined);
      setCompareWhenStable(false);
    }
  }
  async function discardConflictBuffer(): Promise<void> {
    if (!conflictedDocument) return;
    await window.textra.unwatchExternalFile({
      projectId: conflictedDocument.projectId,
      path: conflictedDocument.path,
    });
    closeDocument(conflictedDocument.path);
    setConflictPath(null);
    setExternalChange(null);
    setComparison(null);
    setConflictSnapshotPath(undefined);
    setCompareWhenStable(false);
  }
  useEffect(() => {
    if (!compareWhenStable || externalStatus.state !== 'stable' || !conflictPath) return;
    void refreshConflictComparison(conflictPath)
      .then(() => setConflictPath(null))
      .catch(showError);
  }, [compareWhenStable, conflictPath, externalStatus.state, refreshConflictComparison]);
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
          if (useWorkspace.getState().project?.id !== project.id) return;
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
      // The operating system's Trash confirmation is the one destructive-action
      // confirmation. Do not make people approve the same deletion twice.
      const next = unwrap(await window.textra.deleteEntry({ projectId: project.id, path }));
      if (useWorkspace.getState().project?.id !== project.id) return;
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
    });
  }
  async function lintDocument(path: string) {
    if (!project || !/\.tex$/i.test(path)) return;
    const result = await runLanguageRequest(project.id, path, 'lint', (requestId) =>
      window.textra.lintLatex({ projectId: project.id, path, requestId }),
    );
    if (!result) return;
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
    const saved = await saveDocument(path);
    if (saved) {
      if (savedTabTimer.current) window.clearTimeout(savedTabTimer.current);
      setSavedTabPath(path);
      savedTabTimer.current = window.setTimeout(() => {
        setSavedTabPath((current) => (current === path ? null : current));
      }, 1200);
    }
    if (saved && preferences.chktexEnabled && preferences.chktexRunMode === 'save')
      void lintDocument(path).catch(() => {
        // Linting is optional and must never make Ctrl+S look like a failed save.
      });
    return saved;
  }
  useEffect(() => {
    if (
      !project ||
      !active ||
      !/\.tex$/i.test(active.path) ||
      !preferences.chktexEnabled ||
      preferences.chktexRunMode !== 'live'
    )
      return;
    const projectId = project.id;
    const path = active.path;
    const timer = window.setTimeout(() => {
      void runLanguageRequest(projectId, path, 'lint', (requestId) =>
        window.textra.lintLatex({ projectId, path, requestId }),
      )
        .then((result) => {
          if (!result) return;
          if (!result.ok) {
            if (result.code !== 'TOOL_MISSING') showError(result.error);
            return;
          }
          setLintDiagnostics((previous) => [
            ...previous.filter(
              (diagnostic) => diagnostic.source !== 'chktex' || diagnostic.file !== path,
            ),
            ...result.value,
          ]);
        })
        .catch(() => {
          // Live linting is advisory and must never interrupt typing.
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [active, preferences.chktexEnabled, preferences.chktexRunMode, project]);
  async function formatActive() {
    if (!project || !active || !/\.tex$/i.test(active.path)) return;
    const preview = await prepareFormatting(project.id, active.path);
    if (preview) setFormatPreview(preview);
  }
  async function prepareProblemPrompt(diagnostic: ProblemDiagnostic, bounded = false) {
    const projectId = project?.id;
    let source = diagnostic.file ? analysisSources[diagnostic.file] : undefined;
    if (!source && project && diagnostic.file) {
      const result = await window.textra.readFile({ projectId: project.id, path: diagnostic.file });
      if (result.ok) source = result.value.content;
    }
    if (useWorkspace.getState().project?.id !== projectId)
      throw new Error('The project changed. Select the problem again.');
    let context = source && !bounded ? extractPromptContext(source, diagnostic.line ?? 1) : null;
    if (bounded && source !== undefined) {
      const lines = source.split(/\r\n|\n|\r/);
      const line = Math.max(1, Math.min(diagnostic.line ?? 1, lines.length));
      const startLine = Math.max(1, line - 5);
      const endLine = Math.min(lines.length, line + 5);
      context = {
        startLine,
        endLine,
        environment: null,
        text: lines
          .slice(startLine - 1, endLine)
          .map(
            (text, index) =>
              `${startLine + index === line ? '>' : ' '} ${startLine + index}: ${text.slice(0, 600)}`,
          )
          .join('\n'),
      };
    }
    const location = diagnostic.file ? ` in \`${diagnostic.file}:${diagnostic.line ?? '?'}\`` : '';
    const isExternalTool =
      diagnostic.source &&
      !['build', 'compiler', 'latex'].includes(diagnostic.source.toLowerCase());
    const sourceLabel =
      diagnostic.source?.toLowerCase() === 'chktex'
        ? 'ChkTeX'
        : diagnostic.source?.toLowerCase() === 'texlab'
          ? 'TexLab'
          : diagnostic.source?.toLowerCase() === 'reference'
            ? 'reference analysis'
            : diagnostic.source;
    const sourceNote =
      isExternalTool && sourceLabel
        ? `Note: This was flagged by ${sourceLabel}, not the LaTeX compiler. If this is a false positive or stylistic preference, also explain how to configure, suppress, or ignore this warning.`
        : null;
    const prompt = [
      '# LaTeX troubleshooting request',
      '',
      `I am working on a LaTeX document and received this ${diagnostic.severity}${location}:`,
      '',
      `> ${diagnostic.code ? `${diagnostic.code}: ` : ''}${bounded ? diagnostic.message.slice(0, 2000) : diagnostic.message}`,
      ...(sourceNote ? ['', sourceNote] : []),
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
    return prompt;
  }
  async function copyProblemPrompt(diagnostic: ProblemDiagnostic) {
    const result = await window.textra.copyText(await prepareProblemPrompt(diagnostic));
    if (!result.ok) throw new Error(result.error);
  }
  async function askProblemInChat(diagnostic: ProblemDiagnostic) {
    const text = await prepareProblemPrompt(diagnostic, true);
    setChatDraft({ id: ++chatDraftId.current, text, projectId: project?.id ?? null });
    setChatOpened(true);
    setSidebarView('chat');
    updatePreferences({ sidebarVisible: true });
  }
  function askSnippetInChat(text: string) {
    setChatDraft({
      id: ++chatDraftId.current,
      text,
      projectId: project?.id ?? null,
      autoSend: false,
    });
    setChatOpened(true);
    setSidebarView('chat');
    updatePreferences({ sidebarVisible: true });
  }
  async function compile() {
    if (!project || !active || !canCompile || build.running || busy || prompt || pending) return;
    const configuredRoot = useWorkspace.getState().projectConfig?.rootFile;
    const rootFile = configuredRoot || active.path;
    // A new build should return Preview to the document it just produced.
    setPdfPreviewPath(null);
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
      markStartup('compile-dispatch');
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
  async function selectRecipe(recipe: string) {
    if (!project || !activePath) return;
    const config = unwrap(await window.textra.getProjectConfig(project.id));
    const saved =
      config.recipes?.[activePath] === recipe
        ? config
        : unwrap(
            await window.textra.setProjectConfig({
              projectId: project.id,
              config: { ...config, recipes: { ...config.recipes, [activePath]: recipe } },
              expectedConfig: config,
            }),
          );
    if (useWorkspace.getState().project?.id !== project.id) return;
    useWorkspace.setState((state) => ({
      projectConfig: saved,
      recipes: { ...state.recipes, [activePath]: recipe },
    }));
  }
  useEffect(() => {
    setHistoryDiff(null);
  }, [activePath]);

  const compareHistorySnapshot = async (snapshot: HistorySnapshotSummary) => {
    if (!project) return;
    const res = await window.textra.readFileHistorySnapshot({
      projectId: project.id,
      path: snapshot.path,
      snapshotId: snapshot.id,
    });
    if (
      useWorkspace.getState().project?.id !== project.id ||
      useWorkspace.getState().activePath !== activePath
    )
      return;
    if (res.ok) {
      if (preferences.previewVisible) {
        updatePreferences({ previewVisible: false });
      }
      if (snapshot.path !== activePath) {
        selectDocument(snapshot.path);
      }
      setHistoryDiff({
        snapshot,
        historicalContent: res.value.content,
      });
    } else {
      showError(res.error);
    }
  };

  const restoreHistorySnapshot = async (snapshot: HistorySnapshotSummary) => {
    if (!project) return;
    const dateStr = new Date(snapshot.createdAt).toLocaleString();
    const confirmed = window.confirm(
      `Restore "${snapshot.path}" to snapshot from ${dateStr}?\n\nCurrent changes will be backed up automatically before restoring.`,
    );
    if (!confirmed) return;
    const res = await restoreHistoryDocument(project.id, snapshot);
    if (useWorkspace.getState().project?.id !== project.id) return;
    if (res.ok) {
      setHistoryDiff(null);
      window.dispatchEvent(new CustomEvent('textra:history:updated'));
      window.dispatchEvent(
        new CustomEvent('textra:notify', {
          detail: {
            message: `Restored ${snapshot.path} from history`,
            tone: 'success',
          },
        }),
      );
    } else {
      showError(res.error);
    }
  };

  const exportHistorySnapshot = async (snapshot: HistorySnapshotSummary) => {
    if (!project) return;
    const res = await window.textra.exportFileHistorySnapshot({
      projectId: project.id,
      path: snapshot.path,
      snapshotId: snapshot.id,
    });
    if (res.ok && res.value) {
      window.dispatchEvent(
        new CustomEvent('textra:notify', {
          detail: {
            message: 'Snapshot exported successfully',
            tone: 'success',
          },
        }),
      );
    } else if (!res.ok) {
      showError(res.error);
    }
  };

  const pinHistorySnapshot = async (
    snapshot: HistorySnapshotSummary,
    pinned: boolean,
    label?: string | null,
  ) => {
    if (!project) return;
    const res = await window.textra.pinFileHistorySnapshot({
      projectId: project.id,
      path: snapshot.path,
      snapshotId: snapshot.id,
      pinned,
      label,
    });
    if (res.ok) {
      if (historyDiff?.snapshot.id === snapshot.id) {
        setHistoryDiff({
          ...historyDiff,
          snapshot: res.value,
        });
      }
      window.dispatchEvent(new CustomEvent('textra:history:updated'));
    } else {
      showError(res.error);
    }
  };

  const deleteHistorySnapshot = async (snapshot: HistorySnapshotSummary) => {
    if (!project) return;
    const res = await window.textra.deleteFileHistorySnapshot({
      projectId: project.id,
      path: snapshot.path,
      snapshotId: snapshot.id,
    });
    if (res.ok) {
      if (historyDiff?.snapshot.id === snapshot.id) {
        setHistoryDiff(null);
      }
      window.dispatchEvent(new CustomEvent('textra:history:updated'));
      notify('Deleted historical snapshot.', 'info');
    } else {
      showError(res.error);
    }
  };

  const createManualHistorySnapshot = async (label?: string) => {
    if (!project || !activePath) return;
    const workspace = useWorkspace.getState();
    const doc = workspace.documents.find((d) => d.path === activePath);
    if (!doc) return;
    const res = await window.textra.createFileHistorySnapshot({
      projectId: project.id,
      path: activePath,
      content: doc.content,
      trigger: 'manual',
      force: true,
      label,
    });
    if (res.ok) {
      window.dispatchEvent(new CustomEvent('textra:history:updated'));
      window.dispatchEvent(
        new CustomEvent('textra:notify', {
          detail: {
            message: `Created snapshot for ${activePath}`,
            tone: 'success',
          },
        }),
      );
    } else {
      showError(res.error);
    }
  };

  useEffect(() => {
    if (!preferences.historyEnabled || !project) return;
    const intervalMs = Math.max(1, preferences.historyIntervalMinutes) * 60 * 1000;
    const timer = setInterval(() => {
      const state = useWorkspace.getState();
      if (!state.project || state.busy) return;
      const dirtyDocs = state.documents.filter(
        (doc) => dirty(doc) && doc.projectId === state.project?.id,
      );
      for (const doc of dirtyDocs) {
        void window.textra
          .createFileHistorySnapshot({
            projectId: doc.projectId,
            path: doc.path,
            content: doc.content,
            trigger: 'interval',
          })
          .then((res) => {
            if (res.ok && res.value) {
              window.dispatchEvent(new CustomEvent('textra:history:updated'));
            }
          })
          .catch(() => undefined);
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [preferences.historyEnabled, preferences.historyIntervalMinutes, project]);

  useEffect(() => {
    const handleCompile = () => void compile();
    const handleSaveActive = () => {
      if (!activePath) return;
      if (
        useWorkspace.getState().documents.find((document) => document.path === activePath)?.conflict
      ) {
        setConflictPath(activePath);
      } else {
        void run(async () => {
          await saveAndLint(activePath);
        });
      }
    };
    const handleSaveCopy = () => saveAs();
    const handleSaveAll = () =>
      void run(async () => {
        await saveAll();
      });
    const handleOpenFolder = () => openFolder();
    const handleNewFile = () => newEntry('file');
    const handleNewFolder = () => newEntry('directory');
    const handleFormatDoc = () => void run(formatActive);
    const handleCleanArtifacts = () => {
      if (!project) return;
      void run(async () => {
        const result = await window.textra.cleanProjectBuildArtifacts(project.id);
        if (!result.ok) throw new Error(result.error);
      });
    };
    const handleCleanAux = () => {
      if (!project || !canCompile || !activePath || busy || build.running) return;
      void run(async () => {
        const res = await window.textra.cleanAuxiliaryFiles({
          projectId: project.id,
          path: activePath,
          recipe: engine,
        });
        if (res.ok) {
          window.dispatchEvent(
            new CustomEvent('textra:notify', {
              detail: {
                message: res.value.removedCount
                  ? `Cleaned ${res.value.removedCount} auxiliary file${res.value.removedCount === 1 ? '' : 's'}`
                  : 'No auxiliary files to clean',
                tone: 'success',
              },
            }),
          );
        } else {
          showError(res.error);
        }
      });
    };
    const handleToggleWrap = () => setWrap(!wrap);
    const handleOpenPdfPreview = (e: Event) => {
      const path = (e as CustomEvent<{ path: string }>).detail?.path;
      if (path) {
        setPdfPreviewPath(path);
        setPanel('preview');
        useUI.getState().setExpandedPane(null);
        updatePreferences({ previewVisible: true });
      }
    };
    const handleOpenMarkdownPreview = () => {
      setPanel('markdown');
      useUI.getState().setExpandedPane(null);
      updatePreferences({ previewVisible: true });
    };
    const handleViewHistory = () => {
      selectSidebarView('history');
    };
    const handleCreateSnapshot = () => {
      selectSidebarView('history');
      void createManualHistorySnapshot();
    };

    window.addEventListener('textra:compile', handleCompile);
    window.addEventListener('textra:save-active', handleSaveActive);
    window.addEventListener('textra:save-copy', handleSaveCopy);
    window.addEventListener('textra:save-all', handleSaveAll);
    window.addEventListener('textra:open-folder', handleOpenFolder);
    window.addEventListener('textra:new-file', handleNewFile);
    window.addEventListener('textra:new-folder', handleNewFolder);
    window.addEventListener('textra:format-document', handleFormatDoc);
    window.addEventListener('textra:clean-artifacts', handleCleanArtifacts);
    window.addEventListener('textra:clean-aux', handleCleanAux);
    window.addEventListener('textra:toggle-wrap', handleToggleWrap);
    window.addEventListener('textra:open-pdf-preview', handleOpenPdfPreview);
    window.addEventListener('textra:open-markdown-preview', handleOpenMarkdownPreview);
    window.addEventListener('textra:view-history', handleViewHistory);
    window.addEventListener('textra:create-snapshot', handleCreateSnapshot);

    return () => {
      window.removeEventListener('textra:compile', handleCompile);
      window.removeEventListener('textra:save-active', handleSaveActive);
      window.removeEventListener('textra:save-copy', handleSaveCopy);
      window.removeEventListener('textra:save-all', handleSaveAll);
      window.removeEventListener('textra:open-folder', handleOpenFolder);
      window.removeEventListener('textra:new-file', handleNewFile);
      window.removeEventListener('textra:new-folder', handleNewFolder);
      window.removeEventListener('textra:format-document', handleFormatDoc);
      window.removeEventListener('textra:clean-artifacts', handleCleanArtifacts);
      window.removeEventListener('textra:clean-aux', handleCleanAux);
      window.removeEventListener('textra:toggle-wrap', handleToggleWrap);
      window.removeEventListener('textra:open-pdf-preview', handleOpenPdfPreview);
      window.removeEventListener('textra:open-markdown-preview', handleOpenMarkdownPreview);
      window.removeEventListener('textra:view-history', handleViewHistory);
      window.removeEventListener('textra:create-snapshot', handleCreateSnapshot);
    };
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
  const vscodeAvailable = tools.some((tool) => tool.name === 'vscode' && Boolean(tool.path));

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
          <IconButton
            small={false}
            className="icon-button activity-view"
            label="File Explorer"
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
          </IconButton>
          {comparison && (
            <IconButton
              small={false}
              className="icon-button activity-view"
              label="Conflict comparison"
              title="Conflict comparison (read-only)"
              aria-pressed={comparison.path === activePath}
              onClick={() => selectDocument(comparison.path)}
            >
              <Columns2 size={19} weight={comparison.path === activePath ? 'duotone' : 'light'} />
            </IconButton>
          )}
          <IconButton
            small={false}
            className="icon-button activity-view"
            label="Writing tools"
            title="Writing: outline, counts and notes"
            aria-pressed={preferences.sidebarVisible && sidebarView === 'writing'}
            onClick={() => selectSidebarView('writing')}
          >
            <Pencil
              size={19}
              weight={preferences.sidebarVisible && sidebarView === 'writing' ? 'duotone' : 'light'}
            />
          </IconButton>
          <IconButton
            small={false}
            className="icon-button activity-view"
            label="Build"
            title="Build"
            aria-pressed={preferences.sidebarVisible && sidebarView === 'compile'}
            onClick={() => selectSidebarView('compile')}
          >
            <Hammer
              size={19}
              weight={preferences.sidebarVisible && sidebarView === 'compile' ? 'duotone' : 'light'}
            />
          </IconButton>
          <IconButton
            small={false}
            className="icon-button activity-view"
            label="Snippets & Symbols"
            title="Snippets & Symbols: math symbols, tables, templates"
            aria-pressed={
              preferences.sidebarVisible &&
              (sidebarView === 'snippets' || sidebarView === 'equations')
            }
            onClick={() => selectSidebarView('snippets')}
          >
            <BracketsCurly
              size={19}
              weight={
                preferences.sidebarVisible &&
                (sidebarView === 'snippets' || sidebarView === 'equations')
                  ? 'duotone'
                  : 'light'
              }
            />
          </IconButton>
          <IconButton
            small={false}
            className="icon-button activity-view"
            label="AI Chat"
            title="AI Chat"
            aria-pressed={preferences.sidebarVisible && sidebarView === 'chat'}
            onClick={() => selectSidebarView('chat')}
          >
            <AIChat
              size={21}
              aria-hidden="true"
              weight={preferences.sidebarVisible && sidebarView === 'chat' ? 'duotone' : 'light'}
            />
          </IconButton>
          <IconButton
            small={false}
            className="icon-button rail-bottom activity-view"
            label="History & Projects"
            title="History & Projects: file snapshots and recent projects"
            aria-pressed={
              preferences.sidebarVisible && (sidebarView === 'history' || sidebarView === 'recents')
            }
            onClick={() => selectSidebarView('history')}
          >
            <History
              size={20}
              weight={
                preferences.sidebarVisible &&
                (sidebarView === 'history' || sidebarView === 'recents')
                  ? 'duotone'
                  : 'light'
              }
            />
          </IconButton>
          <IconButton
            small={false}
            className="icon-button"
            label="Settings and TeX setup"
            title="Settings"
            onClick={() => onOpenSettings?.()}
          >
            <Settings size={19} />
          </IconButton>
        </nav>
        {chatOpened && (
          <aside
            className="sidebar ai-chat-sidebar"
            aria-label="AI Chat sidebar"
            hidden={!preferences.sidebarVisible || sidebarView !== 'chat'}
            style={{ width: preferences.sidebarWidth }}
          >
            <ChatPanel
              agentContext={agentContext}
              documentAvailable={
                !!active &&
                /\.tex$/i.test(active.path) &&
                !active.conflict &&
                active.content.length <= AGENT_SOURCE_LIMIT
              }
              onDocumentAccessChange={setAgentAccessNeeded}
              onAgentWorkingChange={setAgentWorking}
              reviewActive={agentProposal !== null}
              reviewOutcome={reviewOutcome}
              onReviewProposal={reviewAgentProposal}
              reviewControls={
                agentProposal ? (
                  <AgentReviewControls
                    total={agentHunks.length}
                    busy={agentReviewBusy}
                    invalidReason={agentInvalidReason}
                    error={agentReviewError}
                    onApproveAll={() =>
                      void runAgentReview(() =>
                        decideAgentHunks(
                          agentHunks.map((hunk) => hunk.id),
                          [],
                        ),
                      )
                    }
                    onRejectAll={() => void runAgentReview(rejectAgentProposal)}
                  />
                ) : null
              }
              resetKey={project?.id ?? null}
              draft={chatDraft?.projectId === (project?.id ?? null) ? chatDraft : null}
              onDraftConsumed={() => setChatDraft(null)}
              active={preferences.sidebarVisible && sidebarView === 'chat'}
            />
          </aside>
        )}
        {preferences.sidebarVisible && sidebarView !== 'chat' && (
          <aside
            className="sidebar"
            aria-label="Project sidebar"
            style={{ width: preferences.sidebarWidth }}
          >
            {sidebarView === 'writing' ? (
              <WritingPanel
                summary={{
                  words: documentAnalysis?.counts.words ?? 0,
                  characters: active?.content.length ?? 0,
                  sections: documentAnalysis?.counts.sections ?? 0,
                  equations: documentAnalysis?.counts.equations ?? 0,
                  figures: documentAnalysis?.counts.figures ?? 0,
                  tables: documentAnalysis?.counts.tables ?? 0,
                  citations: documentAnalysis?.counts.citations ?? 0,
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
                onJumpToLine={(line) => {
                  if (active)
                    void openDocument(active.path, { path: active.path, line, column: 1 });
                }}
                onFormatDocument={() => void run(formatActive)}
                formatAvailable={tools.some((tool) => tool.name === 'latexindent' && !!tool.path)}
                onMoveSection={(fromIndex, toIndex, position) => {
                  if (!active || !documentAnalysis?.outline) return;
                  const newContent = moveSectionInLatex(
                    active.content,
                    fromIndex,
                    toIndex,
                    position,
                    documentAnalysis.outline,
                  );
                  if (newContent !== active.content) {
                    editDocument(active.path, newContent);
                    window.dispatchEvent(
                      new CustomEvent('textra:apply-document-content', {
                        detail: { path: active.path, text: newContent },
                      }),
                    );
                  }
                }}
              />
            ) : sidebarView === 'snippets' || sidebarView === 'equations' ? (
              <>
                <PaneHeader title="Snippets & Symbols" className="sidebar-title"></PaneHeader>
                <SnippetPalette canInsert={!!active} onAskChat={askSnippetInChat} />
              </>
            ) : sidebarView === 'compile' ? (
              <div className="writing-panel compile-sidebar">
                <PaneHeader
                  title="Build"
                  className="sidebar-title writing-title build-sidebar-title"
                >
                  <div className="build-header-actions">
                    <CompileControl
                      running={build.running}
                      feedback={buildFeedback}
                      canCompile={canCompile}
                      busy={busy}
                      missingTool={Boolean(missingTool)}
                      engine={engine}
                      activePath={activePath}
                      stepsDone={build.stepsDone}
                      stepCount={build.stepCount}
                      onCompile={() => void compile()}
                      onCancel={() =>
                        void run(async () => {
                          unwrap(await window.textra.cancelBuild());
                        })
                      }
                    />
                    <ProblemsButton
                      severity={issueSeverity}
                      issueCount={issueCount}
                      errorCount={errorCount}
                      warningCount={warningCount}
                      onClick={() => {
                        setPanel('problems');
                        updatePreferences({ previewVisible: true });
                      }}
                    />
                    <IconButton
                      small={true}
                      className="icon-button small"
                      label="Clear auxiliary files"
                      title={
                        !canCompile
                          ? 'Open a .tex document to clear auxiliary files.'
                          : 'Clear auxiliary files (preserves PDF)'
                      }
                      disabled={!project || !canCompile || busy || build.running}
                      onClick={() => {
                        if (!project || !canCompile || !activePath || busy || build.running) return;
                        void run(async () => {
                          const res = await window.textra.cleanAuxiliaryFiles({
                            projectId: project.id,
                            path: activePath,
                            recipe: engine,
                          });
                          if (res.ok) {
                            window.dispatchEvent(
                              new CustomEvent('textra:notify', {
                                detail: {
                                  message: res.value.removedCount
                                    ? `Cleaned ${res.value.removedCount} auxiliary file${res.value.removedCount === 1 ? '' : 's'}`
                                    : 'No auxiliary files to clean',
                                  tone: 'success',
                                },
                              }),
                            );
                          } else {
                            showError(res.error);
                          }
                        });
                      }}
                    >
                      <Broom size={15} />
                    </IconButton>
                  </div>
                </PaneHeader>
                {project && (
                  <div
                    className="build-recipe-editor-wrap"
                    style={{ padding: '0 12px', flex: 1, overflowY: 'auto' }}
                  >
                    <CompileRecipeEditor
                      activePath={activePath}
                      config={projectConfig}
                      disabled={!canCompile || busy || build.running}
                      projectId={project.id}
                      recipeName={engine}
                      onSelectRecipe={(recipe) => void selectRecipe(recipe)}
                      onSaved={(config, savedRecipeName) => {
                        useWorkspace.setState((state) => ({
                          projectConfig: config,
                          recipes: activePath
                            ? { ...state.recipes, [activePath]: savedRecipeName }
                            : state.recipes,
                        }));
                      }}
                    />
                  </div>
                )}
              </div>
            ) : sidebarView === 'history' || sidebarView === 'recents' ? (
              <HistoryPanel
                projectId={project?.id ?? null}
                projectName={project?.rootPath}
                activePath={activePath}
                activeContent={active?.content}
                isDirty={Boolean(active && dirty(active))}
                selectedSnapshotId={historyDiff?.snapshot.id ?? null}
                onCompareSnapshot={(snapshot) => void compareHistorySnapshot(snapshot)}
                onRestoreSnapshot={(snapshot) => restoreHistorySnapshot(snapshot)}
                onExportSnapshot={(snapshot) => exportHistorySnapshot(snapshot)}
                onDeleteSnapshot={(snapshot) => deleteHistorySnapshot(snapshot)}
                onPinSnapshot={(snapshot, pinned, label) =>
                  pinHistorySnapshot(snapshot, pinned, label)
                }
                onCreateSnapshot={(label) => createManualHistorySnapshot(label)}
                recents={recents}
                onOpenFolder={(id) => openFolder(id)}
                onPinProject={async (id, pinned) => {
                  void run(async () => {
                    useWorkspace.setState({
                      recents: unwrap(await window.textra.setProjectPinned({ id, pinned })),
                    });
                  });
                }}
                projectBusy={busy || build.running}
              />
            ) : (
              <>
                <PaneHeader title="Files" className="sidebar-title">
                  <div className="inline-actions">
                    <IconButton
                      small={true}
                      className="icon-button small"
                      label="Open folder"
                      title="Open folder"
                      onClick={() => openFolder()}
                      disabled={busy || build.running}
                    >
                      <FolderOpen size={15} />
                    </IconButton>
                    {project && (
                      <>
                        <IconButton
                          small={true}
                          className="icon-button small"
                          label="Reveal folder in explorer"
                          title="Reveal folder in explorer"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              unwrap(
                                await window.textra.revealEntry({
                                  projectId: project.id,
                                  path: '',
                                }),
                              );
                            })
                          }
                        >
                          <ArrowSquareOut size={15} />
                        </IconButton>
                        <IconButton
                          small={true}
                          className="icon-button small"
                          label={
                            vscodeAvailable
                              ? 'Open folder in VS Code'
                              : 'Visual Studio Code is not installed'
                          }
                          title={
                            vscodeAvailable
                              ? 'Open folder in VS Code'
                              : 'Visual Studio Code is not installed'
                          }
                          disabled={busy || !vscodeAvailable}
                          onClick={() =>
                            void run(async () => {
                              unwrap(
                                await window.textra.openInCode({ projectId: project.id, path: '' }),
                              );
                            })
                          }
                        >
                          <VSCodeIcon size={14} />
                        </IconButton>
                      </>
                    )}
                  </div>
                </PaneHeader>
                {project && (
                  <label className="file-filter">
                    <span className="sr-only">Filter project files</span>
                    <input
                      aria-label="Filter project files"
                      placeholder="Filter files"
                      value={fileFilter}
                      onChange={(event) => setFileFilter(event.target.value)}
                    />
                  </label>
                )}
                <div className="project-heading" title={project?.rootPath}>
                  <span>{project?.name ?? 'No project open'}</span>
                  {project && (
                    <div className="inline-actions">
                      <IconButton
                        small={true}
                        className="icon-button small"
                        label="New file"
                        title="New file"
                        disabled={busy}
                        onClick={() => newEntry('file')}
                      >
                        <FilePlus2 size={15} />
                      </IconButton>
                      <IconButton
                        small={true}
                        className="icon-button small"
                        label="New folder"
                        title="New folder"
                        disabled={busy}
                        onClick={() => newEntry('directory')}
                      >
                        <FolderPlus size={15} />
                      </IconButton>
                    </div>
                  )}
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
                                  openExplorerFile(file.path);
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
                    documents.map((document, index) => (
                      <div
                        className={`document-tab ${document.path === activePath ? 'selected' : ''}${document.path === previewPath ? ' preview-tab' : ''}${savedTabPath === document.path ? ' tab-saved-pulse' : ''}`}
                        key={document.path}
                        data-close-buttons={preferences.tabCloseButtons}
                        draggable={true}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', String(index));
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const fromIndex = Number(e.dataTransfer.getData('text/plain'));
                          if (!isNaN(fromIndex) && fromIndex !== index) {
                            reorderDocuments(fromIndex, index);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setTabContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            path: document.path,
                            index,
                          });
                        }}
                        onAuxClick={(event) => {
                          if (event.button === 1) {
                            event.preventDefault();
                            if (dirty(document)) protect(async () => closeDocument(document.path));
                            else closeDocument(document.path);
                          }
                        }}
                      >
                        <button
                          role="tab"
                          aria-label={`Edit ${document.path}`}
                          aria-selected={document.path === activePath}
                          title={document.path}
                          onClick={() => {
                            setPreviewPath((current) =>
                              current === document.path ? null : current,
                            );
                            if (/\.md(?:own)?$/i.test(document.path)) {
                              setPanel('markdown');
                            }
                            selectDocument(document.path);
                          }}
                        >
                          <FileText size={13} />
                          <span>{document.path.split('/').at(-1)}</span>
                          <span
                            className={`dirty-dot ${dirty(document) ? 'is-dirty' : ''}`}
                            aria-label={dirty(document) ? 'Unsaved changes' : undefined}
                          />
                          {document.conflict && (
                            <Warning size={12} aria-label="External change conflict" />
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
                {documents.length > 2 && (
                  <DropdownMenu
                    className="tab-overflow-dropdown"
                    ariaLabel="Open tabs list"
                    title="Open tabs list"
                    align="right"
                    fullWidth={false}
                    value={activePath}
                    customTrigger={(open) => (
                      <IconButton
                        small={true}
                        className="icon-button small"
                        label="Open tabs list"
                        title="Open tabs list"
                        aria-expanded={open}
                      >
                        <ChevronDown size={13} />
                      </IconButton>
                    )}
                    items={[
                      {
                        group: `OPEN EDITORS (${documents.length})`,
                        items: documents.map((doc) => ({
                          value: doc.path,
                          label: doc.path.split('/').at(-1) || '',
                          icon: <FileText size={13} />,
                          description: dirty(doc) ? <span className="dirty-dot" /> : undefined,
                          onClick: () => {
                            if (/\.md(?:own)?$/i.test(doc.path)) {
                              setPanel('markdown');
                            }
                            selectDocument(doc.path);
                          },
                        })),
                      },
                    ]}
                  />
                )}
                {active && (
                  <div className="editor-tab-actions">
                    <IconButton
                      small={true}
                      className="icon-button small"
                      label="Save file"
                      title="Save (Ctrl/Cmd+S)"
                      disabled={!dirty(active) || busy || active.conflict}
                      onClick={() =>
                        void run(async () => {
                          await saveAndLint(active.path);
                        })
                      }
                    >
                      <Save size={15} />
                    </IconButton>
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
                            : 'Expand editor to full width (Ctrl/Cmd+Enter still compiles)'
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
                      <IconButton
                        small={true}
                        className="icon-button small"
                        label="Editor options"
                        title="Editor options"
                        aria-expanded={editorOptionsOpen}
                        aria-controls="editor-options-panel"
                        onClick={() => setEditorOptionsOpen(!editorOptionsOpen)}
                      >
                        <Ellipsis size={17} />
                      </IconButton>
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
                            <DropdownMenu
                              ariaLabel="Editor font size"
                              fullWidth={true}
                              value={String(fontSize)}
                              items={[...new Set([12, 14, 16, 18, 20, 24, fontSize])]
                                .sort((a, b) => a - b)
                                .map((size) => ({
                                  value: String(size),
                                  label: `${size}px`,
                                }))}
                              onChange={(val) => setFontSize(Number(val))}
                            />
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
                            aria-label="Toggle formatting bar"
                            aria-pressed={formatToolbarVisible}
                            onClick={() =>
                              updatePreferences({ formatToolbarVisible: !formatToolbarVisible })
                            }
                          >
                            Formatting bar <span>{formatToolbarVisible ? 'Shown' : 'Hidden'}</span>
                          </button>
                          <div
                            className="editor-layout-presets"
                            aria-label="Workspace layout presets"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedPane(null);
                                updatePreferences({
                                  sidebarVisible: true,
                                  previewVisible: true,
                                  editorWidth: 55,
                                });
                              }}
                            >
                              Split
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedPane('preview');
                                updatePreferences({ sidebarVisible: false, previewVisible: true });
                              }}
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedPane(null);
                                updatePreferences({ sidebarVisible: false, previewVisible: false });
                              }}
                            >
                              Focus writing
                            </button>
                          </div>
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
                      <span>
                        {active.externalState === 'changing'
                          ? 'This file is changing outside TeXtra. Your open text is protected.'
                          : 'This file changed outside TeXtra. Your open text is protected.'}
                      </span>
                      <div>
                        <button
                          onClick={() => {
                            setConflictPath(active.path);
                            setExternalChange((current) =>
                              current?.path === active.path
                                ? current
                                : {
                                    projectId: active.projectId,
                                    path: active.path,
                                    state: active.externalState ?? 'stable',
                                    revision: null,
                                    observedAt: Date.now(),
                                  },
                            );
                          }}
                        >
                          Resolve conflict
                        </button>
                        <button onClick={saveAs}>Save as…</button>
                      </div>
                    </div>
                  )}
                  {comparison?.path === active.path ? (
                    <ConflictDiffView
                      document={{ path: comparison.path, content: comparison.localContent }}
                      externalContent={comparison.externalContent}
                      external={externalStatus}
                      snapshotPath={conflictSnapshotPath}
                      theme={preferences.theme}
                      onClose={() => setComparison(null)}
                    />
                  ) : historyDiff && historyDiff.snapshot.path === active.path ? (
                    <HistoryDiffView
                      document={{ path: active.path, content: active.content }}
                      historicalSnapshot={historyDiff.snapshot}
                      historicalContent={historyDiff.historicalContent}
                      theme={preferences.theme}
                      onClose={() => setHistoryDiff(null)}
                      onRestore={() => restoreHistorySnapshot(historyDiff.snapshot)}
                      onExport={() => exportHistorySnapshot(historyDiff.snapshot)}
                      onPin={(pinned, label) =>
                        pinHistorySnapshot(historyDiff.snapshot, pinned, label)
                      }
                    />
                  ) : (
                    <div className="agent-review-editor-stack">
                      <div
                        className={`agent-review-source-host${agentProposal ? ' is-reviewing' : ''}${agentWorking ? ' is-agent-working' : ''}`}
                        inert={agentProposal !== null}
                      >
                        <SourceEditor
                          key={project?.id}
                          documents={documents}
                          activePath={active.path}
                          theme={preferences.theme}
                          navigation={navigation}
                          fontSize={fontSize}
                          wrap={wrap}
                          readOnly={busy || active.conflict}
                          aiSuppressed={Boolean(agentProposal)}
                          autoSavePaused={agentProposal !== null}
                          formatToolbarVisible={formatToolbarVisible}
                          bibliographyEntries={bibliographyEntries}
                          texlab={texlabAdapter}
                        />
                      </div>
                      {agentProposal && (
                        <AgentInlineReview
                          proposal={agentProposal}
                          hunks={agentHunks}
                          onDecide={(id, decision) =>
                            void runAgentReview(() =>
                              decideAgentHunks(
                                decision === 'approved' ? [id] : [],
                                decision === 'rejected' ? [id] : [],
                              ),
                            )
                          }
                          invalidReason={agentInvalidReason}
                          busy={agentReviewBusy}
                          theme={preferences.theme}
                        />
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="welcome-content">
                  <div className="welcome-logo" aria-hidden="true">
                    <TextraLogo size={56} />
                  </div>
                  <h1>TeXtra</h1>
                  <p className="welcome-description">
                    Fast, local LaTeX with intelligent writing assistance.
                  </p>
                  <div className="welcome-actions" role="group" aria-label="Workspace actions">
                    <button
                      type="button"
                      className="welcome-action-item"
                      onClick={() => (project ? newEntry('file') : openFolder())}
                      disabled={busy}
                    >
                      <FilePlus2 size={20} aria-hidden="true" />
                      <span>New File...</span>
                    </button>
                    <button
                      type="button"
                      className="welcome-action-item"
                      onClick={() => {
                        if (project) {
                          updatePreferences({ sidebarVisible: true });
                          setSidebarView('explorer');
                        } else {
                          openFolder();
                        }
                      }}
                      disabled={busy}
                    >
                      <FileText size={20} aria-hidden="true" />
                      <span>Open File</span>
                    </button>
                    <button
                      type="button"
                      className="welcome-action-item"
                      onClick={() => openFolder()}
                      disabled={busy}
                    >
                      <FolderOpen size={20} aria-hidden="true" />
                      <span>Open Folder</span>
                    </button>
                    <button
                      type="button"
                      className="welcome-action-item"
                      onClick={generateWorkspace}
                      disabled={busy}
                    >
                      <AIChat size={20} aria-hidden="true" />
                      <span>Generate Workspace</span>
                    </button>
                  </div>
                  {recents.length > 0 && (
                    <section
                      className="welcome-recent-card"
                      aria-labelledby="welcome-recent-heading"
                    >
                      <h2 id="welcome-recent-heading">Recent</h2>
                      <ul className="welcome-recent-list">
                        {recents.slice(0, 5).map((recent) => (
                          <li key={recent.id} className="welcome-recent-row">
                            <button
                              type="button"
                              className="welcome-recent-link"
                              title={recent.rootPath}
                              disabled={busy || build.running}
                              onClick={() => openFolder(recent.id)}
                            >
                              <span className="welcome-recent-name">{recent.name}</span>
                              <span className="welcome-recent-path">{recent.rootPath}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className="welcome-recent-more"
                        disabled={busy || build.running}
                        onClick={() => openFolder()}
                      >
                        More...
                      </button>
                    </section>
                  )}
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
                  <CompileControl
                    running={build.running}
                    feedback={buildFeedback}
                    canCompile={canCompile}
                    busy={busy}
                    missingTool={Boolean(missingTool)}
                    engine={engine}
                    activePath={activePath}
                    stepsDone={build.stepsDone}
                    stepCount={build.stepCount}
                    onCompile={() => void compile()}
                    onCancel={() =>
                      void run(async () => {
                        unwrap(await window.textra.cancelBuild());
                      })
                    }
                    recipeToggle={{
                      open: recipeOpen,
                      onToggle: () => {
                        if (recipeOpen) setRecipeOpen(false);
                        else if (project)
                          void run(async () => {
                            const config = unwrap(await window.textra.getProjectConfig(project.id));
                            if (useWorkspace.getState().project?.id !== project.id) return;
                            useWorkspace.setState({ projectConfig: config });
                            setRecipeOpen(true);
                          });
                      },
                    }}
                  />
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
                            setRecipeOpen(false);
                            void run(() => selectRecipe(recipe.name));
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
                          window.dispatchEvent(
                            new CustomEvent('textra:open-settings', {
                              detail: { section: 'compilation' },
                            }),
                          );
                        }}
                      >
                        Manage recipes…
                      </button>
                    </div>
                  )}
                </div>
                <div className="preview-tabs-host" ref={setTabsHost}>
                  {tabMode === 'menu' ? (
                    <DropdownMenu
                      className="preview-tabs-dropdown"
                      ariaLabel="Preview views"
                      align="right"
                      fullWidth={false}
                      value={panel}
                      customTrigger={(open) => (
                        <IconButton
                          small={true}
                          className="icon-button small"
                          label="Preview menu"
                          aria-haspopup="menu"
                          aria-expanded={open}
                          title="Views and PDF controls"
                        >
                          <Ellipsis size={17} />
                        </IconButton>
                      )}
                      footer={
                        panel === 'preview' ? (
                          <div className="preview-menu-pdf" ref={setPdfMenuSlot} />
                        ) : undefined
                      }
                      items={(
                        [
                          'preview',
                          'problems',
                          'output',
                          ...(hasMarkdown ? (['markdown'] as const) : []),
                        ] as const
                      ).map((name) => ({
                        value: name,
                        label:
                          name === 'preview'
                            ? 'Preview'
                            : name === 'problems'
                              ? 'Problems'
                              : name === 'output'
                                ? 'Output'
                                : 'Markdown',
                        icon:
                          name === 'preview' ? (
                            <FilePdf size={15} />
                          ) : name === 'problems' ? (
                            <Warning size={15} />
                          ) : name === 'output' ? (
                            <Scroll size={15} />
                          ) : (
                            <MarkdownLogo size={15} />
                          ),
                        description:
                          name === 'problems' && !!problemDiagnostics.length ? (
                            <span className="count">{problemDiagnostics.length}</span>
                          ) : undefined,
                        onClick: () => setPanel(name),
                      }))}
                    />
                  ) : (
                    <div
                      className="preview-tabs"
                      role="tablist"
                      aria-label="Preview views"
                      data-mode={tabMode}
                    >
                      {(
                        [
                          'preview',
                          'problems',
                          'output',
                          ...(hasMarkdown ? (['markdown'] as const) : []),
                        ] as const
                      ).map((name, index, names) => (
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
                                : name === 'output'
                                  ? 'Output'
                                  : 'Markdown'
                          }
                          aria-label={
                            name === 'preview'
                              ? 'Preview'
                              : name === 'problems'
                                ? 'Problems'
                                : name === 'output'
                                  ? 'Output'
                                  : 'Markdown Preview'
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
                            ) : name === 'output' ? (
                              <Scroll size={16} />
                            ) : (
                              <MarkdownLogo size={16} />
                            ))}
                          {tabMode === 'full' &&
                            (name === 'preview' ? (
                              'Preview'
                            ) : name === 'problems' ? (
                              'Problems'
                            ) : name === 'output' ? (
                              'Output'
                            ) : (
                              <>
                                <MarkdownLogo size={14} />
                                <span>Markdown</span>
                              </>
                            ))}
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
                  <IconButton
                    small={true}
                    className="icon-button small header-secondary"
                    label="Copy build output"
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
                  </IconButton>
                )}
                <IconButton
                  small={true}
                  className="icon-button small header-secondary"
                  label={
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
                </IconButton>
              </div>
              <div
                className="pdf-tab-content"
                id="preview-panel"
                role="tabpanel"
                aria-labelledby="preview-tab"
                hidden={panel !== 'preview'}
              >
                {previewLoaded && (currentBuild?.pdfPath || pdfPreviewPath || restoredPdf) ? (
                  <PdfViewer
                    project={project}
                    build={
                      currentBuild?.pdfPath
                        ? build
                        : restoredPdf
                          ? {
                              ...build,
                              projectId: restoredPdf.projectId,
                              rootFile: restoredPdf.rootFile,
                              pdfPath: restoredPdf.path,
                              pdfVersion: restoredPdf.pdfVersion,
                            }
                          : build
                    }
                    restored={!!restoredPdf && !pdfPreviewPath}
                    externalPdfPath={pdfPreviewPath}
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
                ) : (
                  <div className="feature-loading" role="status">
                    Compile a document to see its PDF preview.
                  </div>
                )}
              </div>
              {hasMarkdown && (
                <div
                  className="pdf-tab-content markdown-tab-content"
                  id="markdown-panel"
                  role="tabpanel"
                  aria-labelledby="markdown-tab"
                  hidden={panel !== 'markdown'}
                >
                  {activeMarkdownDoc ? (
                    <MarkdownPreview
                      source={activeMarkdownDoc.content}
                      path={activeMarkdownDoc.path}
                    />
                  ) : (
                    <div className="feature-loading" role="status">
                      Open a Markdown document to preview it.
                    </div>
                  )}
                </div>
              )}
              {panel !== 'preview' && panel !== 'markdown' && (
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
                      onAskChat={(diagnostic) => {
                        void askProblemInChat(diagnostic).catch(showError);
                      }}
                      diagnostics={problemDiagnostics}
                      showCommonHelp={preferences.commonProblemHelp}
                      onOpenCommonHelp={(url) => {
                        void window.textra.openTexFaqHelp(url).then((result) => {
                          if (!result.ok) showError(result.error);
                        });
                      }}
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
                      onCopyPrompt={async (diagnostic) => {
                        try {
                          await copyProblemPrompt(diagnostic);
                        } catch (error) {
                          showError(error);
                          throw error;
                        }
                      }}
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
                <CompileControl
                  variant="collapsed"
                  running={build.running}
                  feedback={buildFeedback}
                  canCompile={canCompile}
                  busy={busy}
                  missingTool={Boolean(missingTool)}
                  engine={engine}
                  activePath={activePath}
                  stepsDone={build.stepsDone}
                  stepCount={build.stepCount}
                  onCompile={() => void compile()}
                  onCancel={() =>
                    void run(async () => {
                      unwrap(await window.textra.cancelBuild());
                    })
                  }
                />
                <IconButton
                  small={true}
                  className="icon-button small"
                  label="Show PDF preview"
                  title="Show PDF preview"
                  onClick={() => {
                    setPanel('preview');
                    updatePreferences({ previewVisible: true });
                  }}
                >
                  <FilePdf size={17} />
                </IconButton>
                <ProblemsButton
                  severity={issueSeverity}
                  issueCount={issueCount}
                  errorCount={errorCount}
                  warningCount={warningCount}
                  onClick={() => {
                    setPanel('problems');
                    updatePreferences({ previewVisible: true });
                  }}
                />
                <IconButton
                  small={true}
                  className="icon-button small"
                  label="Show build output"
                  title="Show build output"
                  onClick={() => {
                    setPanel('output');
                    updatePreferences({ previewVisible: true });
                  }}
                >
                  <Scroll size={17} />
                </IconButton>
                {hasMarkdown && (
                  <IconButton
                    small={true}
                    className="icon-button small"
                    label="Show Markdown preview"
                    title="Show Markdown preview"
                    onClick={() => {
                      setPanel('markdown');
                      updatePreferences({ previewVisible: true });
                    }}
                  >
                    <MarkdownLogo size={17} />
                  </IconButton>
                )}
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
            disabled={
              busy ||
              build.running ||
              !project.files.some((file) => file.path === fileMenu.path && file.kind === 'file')
            }
            onClick={() => {
              setFileMenu(null);
              duplicateEntry();
            }}
          >
            Duplicate
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
            disabled={busy || !vscodeAvailable}
            title={vscodeAvailable ? undefined : 'Visual Studio Code is not installed'}
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
          {project.files.some((file) => file.path === fileMenu.path && file.kind === 'file') && (
            <button
              role="menuitem"
              disabled={busy}
              onClick={() => {
                const path = fileMenu.path;
                setFileMenu(null);
                openExplorerFile(path);
                selectSidebarView('history');
              }}
            >
              View File History
            </button>
          )}
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
      {tabContextMenu && (
        <div
          className="file-menu tab-context-menu"
          role="menu"
          tabIndex={-1}
          aria-label={'Tab actions for ' + tabContextMenu.path}
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setTabContextMenu(null);
          }}
        >
          <div className="file-menu-name">{tabContextMenu.path.split('/').at(-1)}</div>
          <button
            role="menuitem"
            onClick={() => {
              const path = tabContextMenu.path;
              setTabContextMenu(null);
              const doc = documents.find((d) => d.path === path);
              if (doc && dirty(doc)) protect(async () => closeDocument(path));
              else closeDocument(path);
            }}
          >
            Close
          </button>
          <button
            role="menuitem"
            disabled={documents.length <= 1}
            onClick={() => {
              const path = tabContextMenu.path;
              setTabContextMenu(null);
              closeOtherTabs(path);
            }}
          >
            Close Other Tabs
          </button>
          <button
            role="menuitem"
            disabled={tabContextMenu.index >= documents.length - 1}
            onClick={() => {
              const idx = tabContextMenu.index;
              setTabContextMenu(null);
              closeTabsToTheRight(idx);
            }}
          >
            Close Tabs to the Right
          </button>
          <button
            role="menuitem"
            disabled={!documents.some((d) => !dirty(d))}
            onClick={() => {
              setTabContextMenu(null);
              closeSavedTabs();
            }}
          >
            Close Saved Tabs
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const path = tabContextMenu.path;
              setTabContextMenu(null);
              selectDocument(path);
              selectSidebarView('history');
            }}
          >
            View File History
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const path = tabContextMenu.path;
              setTabContextMenu(null);
              void navigator.clipboard.writeText(path);
            }}
          >
            Copy Relative Path
          </button>
          {project && (
            <button
              role="menuitem"
              onClick={() => {
                const path = tabContextMenu.path;
                setTabContextMenu(null);
                void run(async () => {
                  unwrap(await window.textra.revealEntry({ projectId: project.id, path }));
                });
              }}
            >
              Open in File Explorer
            </button>
          )}
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
                  if (formatPreview && !applyFormatting(formatPreview))
                    showError(
                      'The document changed after formatting. Format it again to review the current text.',
                    );
                  setFormatPreview(null);
                }}
              >
                Apply formatted text
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {conflictedDocument && (
        <ConflictDialog
          open={!!conflictedDocument}
          document={conflictedDocument}
          external={externalStatus}
          onRefresh={async () => {
            if (!conflictedDocument) return;
            const result = await window.textra.watchExternalFile({
              projectId: conflictedDocument.projectId,
              path: conflictedDocument.path,
              pollingOnly: preferences.externalChangePollingOnly,
              quietPeriodMs: preferences.externalChangeQuietPeriodMs,
            });
            if (!result.ok) throw new Error(result.error);
            if (result.value.state !== 'watching') setExternalChange(result.value);
          }}
          onPreserve={({ compareWhenStable }) => preserveConflictCopy(compareWhenStable)}
          onCreateSnapshot={
            conflictSnapshotPath
              ? ({ compareWhenStable }) => preserveConflictCopy(compareWhenStable)
              : undefined
          }
          onDiscard={discardConflictBuffer}
        />
      )}
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
