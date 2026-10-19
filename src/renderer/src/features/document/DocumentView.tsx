import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  buildDocumentModel,
  type DocumentModel,
  type DocumentNode,
  type OutlineItem,
} from '../../../../shared/document-model';
import { basenameOf, buildFileIndex } from '../../../../shared/tex-structure';
import {
  BookBookmark,
  ChevronRight,
  FileText,
  Image,
  Package,
  RefreshCw,
  WarningCircle,
} from '../../icons';
import { openDocument, useWorkspace } from '../../state/workspace';
import './document.css';

const TEX_FILE = /\.(tex|ltx)$/i;
const REBUILD_DELAY_MS = 250;
const FILES_HEIGHT_DEFAULT = 150;
const FILES_HEIGHT_MIN = 64;
const OUTLINE_HEIGHT_MIN = 96;
const SPLITTER_SIZE = 5;
const STORAGE_KEY = 'textra.documentView';

interface LayoutState {
  outlineOpen: boolean;
  filesOpen: boolean;
  filesHeight: number;
}
const DEFAULT_LAYOUT: LayoutState = {
  outlineOpen: true,
  filesOpen: true,
  filesHeight: FILES_HEIGHT_DEFAULT,
};

/** Per-viewer convenience only: any storage failure falls back to the defaults. */
function loadLayout(): LayoutState {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<LayoutState> | null;
    return {
      outlineOpen: typeof stored?.outlineOpen === 'boolean' ? stored.outlineOpen : true,
      filesOpen: typeof stored?.filesOpen === 'boolean' ? stored.filesOpen : true,
      filesHeight:
        typeof stored?.filesHeight === 'number' && Number.isFinite(stored.filesHeight)
          ? Math.max(FILES_HEIGHT_MIN, Math.round(stored.filesHeight))
          : FILES_HEIGHT_DEFAULT,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}
function saveLayout(layout: LayoutState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* storage unavailable: the layout simply is not remembered */
  }
}
function clampFilesHeight(value: number, total: number): number {
  const max = Math.max(FILES_HEIGHT_MIN, total - OUTLINE_HEIGHT_MIN - SPLITTER_SIZE);
  return Math.round(Math.min(max, Math.max(FILES_HEIGHT_MIN, value)));
}

function SectionHeader({
  id,
  title,
  count,
  open,
  onToggle,
}: {
  id: string;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <h3 className="doc-section-title">
      <button
        className="doc-section-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <ChevronRight
          size={12}
          aria-hidden="true"
          className={'folder-chevron' + (open ? ' expanded' : '')}
        />
        <span>{title}</span>
      </button>
      <span className="doc-count">{count}</span>
    </h3>
  );
}

function Splitter({
  height,
  container,
  onChange,
}: {
  height: number;
  container: React.RefObject<HTMLDivElement | null>;
  onChange: (height: number) => void;
}) {
  const dragging = useRef(false);
  const total = () => container.current?.getBoundingClientRect().height ?? 0;
  const resizeTo = (clientY: number) => {
    const box = container.current?.getBoundingClientRect();
    if (box) onChange(clampFilesHeight(box.bottom - clientY, box.height));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const changes: Record<string, number> = {
      ArrowUp: height + 16,
      ArrowDown: height - 16,
      Home: Number.MAX_SAFE_INTEGER,
      End: FILES_HEIGHT_MIN,
    };
    if (event.key in changes) {
      event.preventDefault();
      onChange(clampFilesHeight(changes[event.key], total()));
    }
  };
  return (
    <div
      className="doc-splitter"
      role="separator"
      aria-label="Outline and files height"
      aria-orientation="horizontal"
      aria-valuemin={FILES_HEIGHT_MIN}
      aria-valuenow={height}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(clampFilesHeight(FILES_HEIGHT_DEFAULT, total()))}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeTo(event.clientY);
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        if (dragging.current) resizeTo(event.clientY);
      }}
      onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        dragging.current = false;
      }}
    />
  );
}

function NodeIcon({ node }: { node: DocumentNode }) {
  if (node.status !== 'ok') return <WarningCircle size={14} aria-hidden="true" />;
  if (node.kind === 'bib') return <BookBookmark size={14} aria-hidden="true" />;
  if (node.kind === 'graphic') return <Image size={14} aria-hidden="true" />;
  if (node.kind === 'package') return <Package size={14} aria-hidden="true" />;
  return <FileText size={14} aria-hidden="true" />;
}

function nodeHint(node: DocumentNode): string {
  if (node.status === 'missing') return `Not found: ${node.target}`;
  if (node.status === 'unchecked') return `${node.target} (project listing was truncated)`;
  if (node.cycle) return `${node.path} includes itself through this chain`;
  if (node.unreadable) return `${node.path} could not be read`;
  if (node.kind === 'graphic') return `${node.path} (image)`;
  return node.path ?? node.target;
}

function FileNodes({
  nodes,
  depth,
  activeRoot,
  collapsed,
  toggle,
}: {
  nodes: DocumentNode[];
  depth: number;
  activeRoot: string;
  collapsed: Set<string>;
  toggle: (key: string) => void;
}) {
  return (
    <ul className="doc-list">
      {nodes.map((node) => {
        const expandable = node.children.length > 0;
        const open = !collapsed.has(node.key);
        const openable = node.status === 'ok' && node.kind !== 'graphic' && node.path !== null;
        const dimmed = node.status !== 'ok' || node.unreadable;
        const label = (
          <>
            <NodeIcon node={node} />
            <span className="doc-label">{node.label}</span>
            {node.cycle && <span className="doc-tag">circular</span>}
            {node.status === 'missing' && <span className="doc-tag">missing</span>}
          </>
        );
        return (
          <li key={node.key}>
            <div className="doc-row" style={{ paddingLeft: depth * 14 }}>
              {expandable ? (
                <button
                  className="doc-twisty"
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
                  onClick={() => toggle(node.key)}
                >
                  <ChevronRight
                    size={12}
                    aria-hidden="true"
                    className={'folder-chevron' + (open ? ' expanded' : '')}
                  />
                </button>
              ) : (
                <span className="doc-twisty-spacer" aria-hidden="true" />
              )}
              {openable ? (
                <button
                  className="doc-entry"
                  title={nodeHint(node)}
                  aria-current={node.path === activeRoot && depth === 0 ? 'true' : undefined}
                  onClick={() => void openDocument(node.path!)}
                >
                  {label}
                </button>
              ) : (
                <span
                  className={'doc-entry static' + (dimmed ? ' dimmed' : '')}
                  title={nodeHint(node)}
                >
                  {label}
                </span>
              )}
            </div>
            {expandable && open && (
              <FileNodes
                nodes={node.children}
                depth={depth + 1}
                activeRoot={activeRoot}
                collapsed={collapsed}
                toggle={toggle}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Outline({ items, activePath }: { items: OutlineItem[]; activePath: string }) {
  const base = Math.min(...items.map((item) => item.level));
  return (
    <ul className="doc-list">
      {items.map((item, position) => {
        const depth = Math.min(item.level - base, 4);
        return (
          <li key={`${item.path}:${item.line}:${position}`}>
            <button
              className="doc-entry doc-heading-entry"
              style={{ paddingLeft: 10 + depth * 12 }}
              title={`${item.path}, line ${item.line}`}
              onClick={() =>
                void openDocument(item.path, { path: item.path, line: item.line, column: 1 })
              }
            >
              <span className={'doc-title level-' + Math.min(depth, 2)}>{item.title}</span>
              {item.path !== activePath && items[position - 1]?.path !== item.path && (
                <span className="doc-from">{basenameOf(item.path)}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Document-centred sidebar: the open file's section outline (included chapters spliced in
 * place) and the tree of files it uses, rather than the contents of the directory.
 */
export function DocumentView() {
  const project = useWorkspace((state) => state.project);
  const activePath = useWorkspace((state) => state.activePath);
  const documents = useWorkspace((state) => state.documents);
  const [model, setModel] = useState<DocumentModel | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [refreshTick, setRefreshTick] = useState(0);
  const [layout, setLayout] = useState<LayoutState>(loadLayout);
  const container = useRef<HTMLDivElement>(null);
  const diskCache = useRef(new Map<string, string | null>());
  const request = useRef(0);
  const projectId = project?.id;
  const projectFiles = project?.files;
  const listingComplete = !project?.truncated;
  const active = activePath && TEX_FILE.test(activePath) ? activePath : null;

  useEffect(() => {
    diskCache.current.clear();
  }, [projectId, active, refreshTick]);

  useEffect(() => {
    const refresh = () => setRefreshTick((tick) => tick + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  useEffect(() => {
    setCollapsed(new Set());
  }, [projectId]);

  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  useEffect(() => {
    const id = ++request.current;
    if (!projectId || !projectFiles || !active) return;
    const timer = window.setTimeout(() => {
      const index = buildFileIndex(
        projectFiles.filter((file) => file.kind === 'file').map((file) => file.path),
      );
      const readSource = async (path: string): Promise<string | null> => {
        const open = useWorkspace.getState().documents.find((document) => document.path === path);
        if (open) return open.content;
        if (diskCache.current.has(path)) return diskCache.current.get(path) ?? null;
        let text: string | null;
        try {
          const result = await window.textra.readFile({ projectId, path });
          text = result.ok ? result.value.content : null;
        } catch {
          text = null;
        }
        diskCache.current.set(path, text);
        return text;
      };
      void buildDocumentModel(active, { readSource, index, listingComplete }).then((next) => {
        if (request.current === id) setModel(next);
      });
    }, REBUILD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [projectId, projectFiles, active, documents, listingComplete, refreshTick]);

  const current = model && active && model.root.path === active ? model : null;
  const toggle = (key: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <>
      <div className="sidebar-title">
        <span className="sidebar-heading">Document</span>
        <button
          className="icon-button small"
          aria-label="Refresh document structure"
          title="Refresh document structure"
          disabled={!active}
          onClick={() => setRefreshTick((tick) => tick + 1)}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      {!project ? (
        <div className="sidebar-empty">
          <p>No project open.</p>
          <span>Open a folder to see how its document fits together.</span>
        </div>
      ) : !active ? (
        <div className="sidebar-empty">
          <p>Nothing to outline.</p>
          <span>Open a .tex file to see its sections and the files it uses.</span>
        </div>
      ) : (
        <>
          <div className="project-heading" title={active}>
            <span>{active}</span>
          </div>
          {!current ? (
            <div className="doc-note" role="status">
              Reading structure
            </div>
          ) : (
            <div className="doc-view" ref={container}>
              <section
                className={'doc-pane doc-outline-pane' + (layout.outlineOpen ? ' open' : '')}
                aria-label="Outline"
              >
                <SectionHeader
                  id="doc-outline-body"
                  title="Outline"
                  count={current.outline.length}
                  open={layout.outlineOpen}
                  onToggle={() => setLayout((l) => ({ ...l, outlineOpen: !l.outlineOpen }))}
                />
                {layout.outlineOpen && (
                  <div className="doc-scroll" id="doc-outline-body">
                    {current.outline.length ? (
                      <Outline items={current.outline} activePath={active} />
                    ) : (
                      <p className="doc-note">No sections in this file yet.</p>
                    )}
                  </div>
                )}
              </section>
              {layout.outlineOpen && layout.filesOpen && (
                <Splitter
                  height={layout.filesHeight}
                  container={container}
                  onChange={(filesHeight) => setLayout((l) => ({ ...l, filesHeight }))}
                />
              )}
              <section
                className={
                  'doc-pane doc-files-pane' +
                  (layout.filesOpen ? ' open' : '') +
                  (layout.filesOpen && layout.outlineOpen ? ' sized' : '')
                }
                style={
                  layout.filesOpen && layout.outlineOpen
                    ? { flexBasis: layout.filesHeight }
                    : undefined
                }
                aria-label="Files used"
              >
                <SectionHeader
                  id="doc-files-body"
                  title="Files used"
                  count={current.root.children.length}
                  open={layout.filesOpen}
                  onToggle={() => setLayout((l) => ({ ...l, filesOpen: !l.filesOpen }))}
                />
                {layout.filesOpen && (
                  <div className="doc-scroll" id="doc-files-body">
                    <FileNodes
                      nodes={[current.root]}
                      depth={0}
                      activeRoot={active}
                      collapsed={collapsed}
                      toggle={toggle}
                    />
                    {current.limited && (
                      <p className="doc-note">Large project: some files are not listed.</p>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </>
  );
}
