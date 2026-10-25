import { useEffect, useMemo, useRef, useState } from 'react';
import { bibliographyDetail, type BibliographyEntry } from '../../../../shared/bibliography';
import {
  buildDocumentModel,
  type DocumentModel,
  type DocumentNode,
  type OutlineItem,
} from '../../../../shared/document-model';
import { basenameOf, buildFileIndex } from '../../../../shared/tex-structure';
import { analyzeLatexDocument, type SourceOccurrence } from '../../../../shared/writing-analysis';
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
import { ResizableSeparator } from '../../components/ResizableSeparator';
import { PanelState } from '../../components/PanelState';
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
  const total = () => container.current?.getBoundingClientRect().height ?? 0;
  return (
    <ResizableSeparator
      orientation="horizontal"
      className="doc-splitter"
      label="Outline and files height"
      value={height}
      min={FILES_HEIGHT_MIN}
      max={clampFilesHeight(Number.MAX_SAFE_INTEGER, total())}
      defaultValue={clampFilesHeight(FILES_HEIGHT_DEFAULT, total())}
      step={16}
      onResize={(newHeight) => onChange(clampFilesHeight(newHeight, total()))}
      computeValueFromPointer={(event) => {
        const box = container.current?.getBoundingClientRect();
        return box ? clampFilesHeight(box.bottom - event.clientY, box.height) : height;
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

function outlineAtLine(items: OutlineItem[], path: string, line: number | null): number {
  if (line === null || line < 1) return -1;
  let activeIndex = -1;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.path === path && item.line <= line) activeIndex = index;
  }
  return activeIndex;
}

function breadcrumbItems(items: OutlineItem[], activeIndex: number): OutlineItem[] {
  if (activeIndex < 0) return [];
  const ancestors: OutlineItem[] = [];
  for (let index = 0; index <= activeIndex; index += 1) {
    const item = items[index];
    if (!item) continue;
    while (true) {
      const parent = ancestors.at(-1);
      if (!parent || parent.level < item.level) break;
      ancestors.pop();
    }
    ancestors.push(item);
  }
  return ancestors;
}

function Breadcrumbs({
  activePath,
  items,
  activeIndex,
}: {
  activePath: string;
  items: OutlineItem[];
  activeIndex: number;
}) {
  const crumbs = breadcrumbItems(items, activeIndex);
  return (
    <nav className="doc-breadcrumbs" aria-label="Document location">
      <button
        type="button"
        title={`Go to the beginning of ${activePath}`}
        onClick={() => void openDocument(activePath, { path: activePath, line: 1, column: 1 })}
      >
        {basenameOf(activePath)}
      </button>
      {crumbs.map((item, index) => (
        <span className="doc-breadcrumb" key={`${item.path}:${item.line}:${index}`}>
          <ChevronRight size={11} aria-hidden="true" />
          <button
            type="button"
            title={`Go to ${item.path}, line ${item.line}`}
            onClick={() =>
              void openDocument(item.path, { path: item.path, line: item.line, column: 1 })
            }
          >
            {item.title}
          </button>
        </span>
      ))}
    </nav>
  );
}

function Outline({
  items,
  activePath,
  activeIndex,
}: {
  items: OutlineItem[];
  activePath: string;
  activeIndex: number;
}) {
  const base = Math.min(...items.map((item) => item.level));
  return (
    <ul className="doc-list">
      {items.map((item, position) => {
        const depth = Math.min(item.level - base, 4);
        return (
          <li key={`${item.path}:${item.line}:${position}`}>
            <button
              className="doc-entry doc-heading-entry"
              aria-current={position === activeIndex ? 'location' : undefined}
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

function CitationList({
  citations,
  entries,
  activePath,
}: {
  citations: SourceOccurrence[];
  entries: readonly BibliographyEntry[];
  activePath: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const entryByKey = useMemo(() => new Map(entries.map((entry) => [entry.key, entry])), [entries]);

  return (
    <ul className="doc-list doc-citation-list">
      {citations.map((citation, index) => {
        const id = `${citation.value}:${citation.line}:${index}`;
        const entry = entryByKey.get(citation.value);
        const detail = entry
          ? `${citation.value} · ${bibliographyDetail(entry)}`
          : `${citation.value} · No matching bibliography entry is currently available.`;
        return (
          <li className="doc-citation" key={id}>
            <button
              type="button"
              className="doc-entry doc-citation-entry"
              aria-describedby={hovered === id ? `${id}-detail` : undefined}
              title={detail}
              onBlur={() => setHovered((current) => (current === id ? null : current))}
              onFocus={() => setHovered(id)}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered((current) => (current === id ? null : current))}
              onClick={() =>
                void openDocument(activePath, {
                  path: activePath,
                  line: citation.line,
                  column: citation.column,
                })
              }
            >
              <BookBookmark size={13} aria-hidden="true" />
              <span className="doc-label">{citation.value}</span>
              <span className="doc-from">Ln {citation.line}</span>
            </button>
            {hovered === id && (
              <span className="doc-citation-tooltip" id={`${id}-detail`} role="tooltip">
                {detail}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface DocumentViewProps {
  /** Overrides the active source line when the host keeps cursor state outside the workspace. */
  activeLine?: number | null;
  /** Parsed open bibliography entries, used for citation hover details. */
  bibliographyEntries?: readonly BibliographyEntry[];
}

/**
 * Document-centred sidebar: the open file's section outline (included chapters spliced in
 * place) and the tree of files it uses, rather than the contents of the directory.
 */
export function DocumentView({
  activeLine: activeLineOverride,
  bibliographyEntries = [],
}: DocumentViewProps) {
  const project = useWorkspace((state) => state.project);
  const activePath = useWorkspace((state) => state.activePath);
  const documents = useWorkspace((state) => state.documents);
  const source = useWorkspace((state) => state.source);
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
  const activeLine =
    activeLineOverride ?? (source?.path === activePath ? (source.line ?? null) : null);
  const activeDocument = documents.find((document) => document.path === active);
  const citations = useMemo(
    () => (activeDocument ? analyzeLatexDocument(activeDocument.content).citations : []),
    [activeDocument],
  );

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
  const activeOutlineIndex =
    current && active ? outlineAtLine(current.outline, active, activeLine) : -1;
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
        <PanelState
          className="sidebar-empty panel-state-compact"
          title="No project open"
          description="Open a folder to see how its document fits together."
        />
      ) : !active ? (
        <PanelState
          className="sidebar-empty panel-state-compact"
          title="Nothing to outline"
          description="Open a .tex file to see its sections and the files it uses."
        />
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
              <Breadcrumbs
                activeIndex={activeOutlineIndex}
                activePath={active}
                items={current.outline}
              />
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
                      <Outline
                        activeIndex={activeOutlineIndex}
                        items={current.outline}
                        activePath={active}
                      />
                    ) : (
                      <p className="doc-note">No sections in this file yet.</p>
                    )}
                    {citations.length > 0 && (
                      <section className="doc-citations" aria-labelledby="doc-citations-heading">
                        <h4 id="doc-citations-heading" className="doc-subsection-title">
                          Citations <span>{citations.length}</span>
                        </h4>
                        <CitationList
                          activePath={active}
                          citations={citations}
                          entries={bibliographyEntries}
                        />
                      </section>
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
