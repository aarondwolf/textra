import { AppTooltip } from '../../components/HelpTooltip';
import { useEffect, useState, useMemo, useRef } from 'react';
import type { HistorySnapshotSummary } from '../../../../shared/api';
import { useHistorySnapshots } from './useHistorySnapshots';
import { ResizableSeparator } from '../../components/ResizableSeparator';
import { PaneHeader } from '../../components/Layout';
import { PanelState } from '../../components/PanelState';
import { CollapsibleSection } from '../../components/CollapsibleSection';
import { IconButton } from '../../components/Button';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useOverlayZIndex } from '../../components/overlay-layers';
import {
  History,
  FolderOpen,
  RefreshCw,
  Plus,
  Pin,
  Trash2,
  X,
  Check,
  Ellipsis,
  Pencil,
} from '../../icons';
import './history.css';

export interface RecentProjectItem {
  id: string;
  name: string;
  rootPath: string;
  pinned?: boolean;
}

export interface HistoryPanelProps {
  projectId: string | null;
  projectName?: string;
  activePath: string | null;
  activeContent?: string;
  isDirty?: boolean;
  selectedSnapshotId?: string | null;
  onCompareSnapshot: (snapshot: HistorySnapshotSummary) => void;
  onDeleteSnapshot?: (snapshot: HistorySnapshotSummary) => Promise<void>;
  onPinSnapshot: (
    snapshot: HistorySnapshotSummary,
    pinned: boolean,
    label?: string | null,
  ) => Promise<void>;
  onCreateSnapshot?: (label?: string) => Promise<void>;
  recents?: RecentProjectItem[];
  onOpenFolder?: (id?: string) => void;
  onPinProject?: (id: string, pinned: boolean) => Promise<void>;
  projectBusy?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoString;
  }
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return isoString;
  }
}

function triggerLabel(trigger: HistorySnapshotSummary['trigger']): string {
  switch (trigger) {
    case 'save':
      return 'Saved';
    case 'compile':
      return 'Compile';
    case 'interval':
      return 'Auto';
    case 'ai':
      return 'AI Edit';
    case 'format':
      return 'Format';
    case 'manual':
      return 'Manual';
    default:
      return trigger;
  }
}

export function HistoryPanel({
  projectId,
  activePath,
  isDirty = false,
  selectedSnapshotId,
  onCompareSnapshot,
  onDeleteSnapshot,
  onPinSnapshot,
  onCreateSnapshot,
  recents = [],
  onOpenFolder,
  onPinProject,
  projectBusy = false,
}: HistoryPanelProps) {
  const floatingZIndex = useOverlayZIndex('floating');
  const {
    snapshots,
    nextCursor,
    loading,
    error: historyError,
    loadSnapshots,
  } = useHistorySnapshots(projectId, activePath);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pinDialogSnapshot, setPinDialogSnapshot] = useState<HistorySnapshotSummary | null>(null);
  const [pinLabelInput, setPinLabelInput] = useState('');
  const [editingSnapshotLabel, setEditingSnapshotLabel] = useState(false);
  const [manualSnapshotPrompt, setManualSnapshotPrompt] = useState(false);
  const [manualLabelInput, setManualLabelInput] = useState('');

  const [historyOpen, setHistoryOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [recentsHeight, setRecentsHeight] = useState(160);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsNarrow(entry.contentRect.width < 280);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleUpdate = () => {
      void loadSnapshots();
    };
    window.addEventListener('textra:history:updated', handleUpdate);
    return () => {
      window.removeEventListener('textra:history:updated', handleUpdate);
    };
  }, [loadSnapshots]);

  const groups = useMemo(() => {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = todayMidnight - 6 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = todayMidnight - 29 * 24 * 60 * 60 * 1000;

    const pinned: HistorySnapshotSummary[] = [];
    const today: HistorySnapshotSummary[] = [];
    const last7Days: HistorySnapshotSummary[] = [];
    const last30Days: HistorySnapshotSummary[] = [];
    const older: HistorySnapshotSummary[] = [];

    for (const snap of snapshots) {
      if (snap.pinned || snap.label) {
        pinned.push(snap);
      }
      const time = new Date(snap.createdAt).getTime();
      if (time >= todayMidnight) {
        today.push(snap);
      } else if (time >= sevenDaysAgo) {
        last7Days.push(snap);
      } else if (time >= thirtyDaysAgo) {
        last30Days.push(snap);
      } else {
        older.push(snap);
      }
    }

    const result: { title: string; items: HistorySnapshotSummary[] }[] = [];
    if (pinned.length > 0) result.push({ title: 'Pinned Versions', items: pinned });
    if (today.length > 0) result.push({ title: 'Today', items: today });
    if (last7Days.length > 0) result.push({ title: 'Last 7 days', items: last7Days });
    if (last30Days.length > 0) result.push({ title: 'Last 30 Days', items: last30Days });
    if (older.length > 0) result.push({ title: 'Older', items: older });

    return result;
  }, [snapshots]);

  const handleTakeSnapshot = async () => {
    if (!onCreateSnapshot) return;
    setBusyAction('manual-snapshot');
    try {
      await onCreateSnapshot(manualLabelInput.trim() || undefined);
      setManualSnapshotPrompt(false);
      setManualLabelInput('');
      await loadSnapshots();
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmPin = async () => {
    if (!pinDialogSnapshot) return;
    setBusyAction(pinDialogSnapshot.id);
    try {
      await onPinSnapshot(pinDialogSnapshot, true, pinLabelInput.trim() || null);
      setPinDialogSnapshot(null);
      setPinLabelInput('');
      await loadSnapshots();
    } finally {
      setBusyAction(null);
    }
  };

  const handleUnpin = async (snapshot: HistorySnapshotSummary) => {
    setBusyAction(snapshot.id);
    try {
      await onPinSnapshot(snapshot, false, null);
      await loadSnapshots();
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async (snapshot: HistorySnapshotSummary) => {
    if (isDirty) return;
    setBusyAction(snapshot.id);
    try {
      if (onDeleteSnapshot) {
        await onDeleteSnapshot(snapshot);
      } else if (projectId) {
        await window.textra.deleteFileHistorySnapshot({
          projectId,
          path: snapshot.path,
          snapshotId: snapshot.id,
        });
      }
      await loadSnapshots();
    } finally {
      setBusyAction(null);
    }
  };

  const fileName = activePath ? activePath.split('/').pop() : null;

  return (
    <div ref={sidebarRef} className={`history-sidebar${isNarrow ? ' is-narrow' : ''}`}>
      <PaneHeader
        title="History & Projects"
        className="sidebar-title"
        actions={
          <div className="inline-actions">
            {onOpenFolder && (
              <IconButton
                small={true}
                className="icon-button small"
                label="Open project folder"
                title="Open project folder"
                disabled={projectBusy}
                onClick={() => onOpenFolder()}
              >
                <FolderOpen size={15} />
              </IconButton>
            )}
            <IconButton
              small={true}
              className="icon-button small"
              label="Refresh history"
              title="Refresh snapshot list"
              disabled={loading || Boolean(busyAction)}
              onClick={() => void loadSnapshots()}
            >
              <RefreshCw size={14} />
            </IconButton>
          </div>
        }
      />

      <div className="history-content">
        {/* Section 1: File History */}
        <CollapsibleSection
          className={`writing-section history-section ${historyOpen ? 'expanded' : 'collapsed'}`}
          title="File History"
          id="history-snapshots-heading"
          icon={<History size={13} aria-hidden="true" />}
          detail={
            fileName && (
              <AppTooltip content={activePath ?? ''}>
                <span className="history-header-filename">{fileName}</span>
              </AppTooltip>
            )
          }
          count={snapshots.length}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          headerClassName="writing-section-toggle"
          headerRowClassName="history-section-header"
          bodyClassName="history-section-body"
          headerActions={
            historyOpen && activePath ? (
              <div className="history-section-header-actions">
                <IconButton
                  small={true}
                  className="icon-button small"
                  label="Create snapshot now"
                  title="Create a snapshot of the current document"
                  disabled={loading || Boolean(busyAction)}
                  onClick={() => setManualSnapshotPrompt(true)}
                >
                  <Plus size={14} />
                </IconButton>
              </div>
            ) : undefined
          }
          style={{
            flex: historyOpen ? '1 1 0' : '0 0 32px',
            height: historyOpen ? undefined : '32px',
            minHeight: historyOpen ? '80px' : '32px',
            maxHeight: historyOpen ? undefined : '32px',
          }}
        >
          {historyOpen && (
            <>
              {manualSnapshotPrompt && (
                <div className="history-prompt-card">
                  <div style={{ display: 'flex', width: '100%', gap: 6, alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="Snapshot label (optional, e.g. Pre-Submission)"
                      value={manualLabelInput}
                      onChange={(e) => setManualLabelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleTakeSnapshot();
                        if (e.key === 'Escape') setManualSnapshotPrompt(false);
                      }}
                      style={{
                        flex: 1,
                        fontSize: '11px',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                      }}
                      autoFocus
                    />
                    <button
                      className="primary-button"
                      style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '4px' }}
                      onClick={() => void handleTakeSnapshot()}
                      disabled={Boolean(busyAction)}
                    >
                      <Check size={12} />
                    </button>
                    <button
                      className="icon-button"
                      style={{ padding: '3px 6px', fontSize: '11px' }}
                      onClick={() => {
                        setManualSnapshotPrompt(false);
                        setManualLabelInput('');
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}

              {pinDialogSnapshot && (
                <div className="history-prompt-card">
                  <span style={{ fontSize: '11px', color: 'var(--text)', fontWeight: 500 }}>
                    {editingSnapshotLabel ? 'Edit version label' : 'Pin version'} (
                    {formatTime(pinDialogSnapshot.createdAt)}):
                  </span>
                  <div style={{ display: 'flex', width: '100%', gap: 6, alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="Tag name (e.g. Camera-Ready, Draft 2)"
                      value={pinLabelInput}
                      onChange={(e) => setPinLabelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleConfirmPin();
                        if (e.key === 'Escape') setPinDialogSnapshot(null);
                      }}
                      style={{
                        flex: 1,
                        fontSize: '11px',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                      }}
                      autoFocus
                    />
                    <button
                      className="primary-button"
                      style={{ padding: '3px 8px', fontSize: '11px', borderRadius: '4px' }}
                      onClick={() => void handleConfirmPin()}
                      disabled={Boolean(busyAction)}
                    >
                      {editingSnapshotLabel ? 'Save label' : 'Pin'}
                    </button>
                    <button
                      className="icon-button"
                      style={{ padding: '3px 6px', fontSize: '11px' }}
                      onClick={() => setPinDialogSnapshot(null)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}

              <div className="history-list" role="region" aria-label="Historical snapshots">
                {historyError && <p role="alert">{historyError}</p>}
                {!activePath ? (
                  <PanelState
                    className="history-empty"
                    icon={<History size={26} weight="thin" />}
                    title="No document selected"
                    description="Open a file in your project to view its automatic historical snapshots."
                  />
                ) : loading && snapshots.length === 0 ? (
                  <PanelState
                    className="history-empty"
                    mode="loading"
                    icon={<RefreshCw size={22} weight="thin" />}
                    title="Loading history…"
                  />
                ) : snapshots.length === 0 ? (
                  <PanelState
                    className="history-empty"
                    icon={<History size={26} weight="thin" />}
                    title="No snapshots yet"
                    description={
                      <>
                        Snapshots are created automatically when saving, compiling, or after
                        intervals of editing.
                      </>
                    }
                  />
                ) : (
                  groups.map((group) => (
                    <div key={group.title} className="history-group">
                      <div className="history-group-title">{group.title}</div>
                      {group.items.map((snap) => {
                        const isSelected = selectedSnapshotId === snap.id;
                        const canDelete = !isDirty;
                        return (
                          <div
                            key={`${group.title}-${snap.id}`}
                            className={`history-item${isSelected ? ' is-selected' : ''}`}
                            role="button"
                            tabIndex={0}
                            aria-pressed={isSelected}
                            onClick={() => onCompareSnapshot(snap)}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onCompareSnapshot(snap);
                              }
                            }}
                          >
                            <div className="history-item-top">
                              <div className="history-item-info">
                                <AppTooltip content={snap.createdAt}>
                                  <span className="history-item-time">
                                    {formatTime(snap.createdAt)}
                                  </span>
                                </AppTooltip>
                                {snap.label && (
                                  <AppTooltip content={snap.label}>
                                    <span className="history-item-label">{snap.label}</span>
                                  </AppTooltip>
                                )}
                                <div className="history-item-meta">
                                  <span>{formatDate(snap.createdAt)}</span>
                                  <span className="history-item-meta-dot">•</span>
                                  <span>{formatBytes(snap.sizeBytes)}</span>
                                </div>
                              </div>

                              <div
                                className="history-item-side"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {isNarrow ? (
                                  <DropdownMenu.Root>
                                    <DropdownMenu.Trigger asChild>
                                      <IconButton
                                        small={true}
                                        className="icon-button small history-card-btn"
                                        label="Snapshot actions"
                                        title="Snapshot actions"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <Ellipsis size={15} weight="bold" />
                                      </IconButton>
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Portal>
                                      <DropdownMenu.Content
                                        className="history-action-menu"
                                        side="bottom"
                                        align="end"
                                        sideOffset={4}
                                        collisionPadding={8}
                                        style={{ zIndex: floatingZIndex }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <DropdownMenu.Item
                                          className={`history-menu-item${snap.pinned ? ' is-pinned' : ''}`}
                                          onSelect={() => {
                                            if (snap.pinned) {
                                              void handleUnpin(snap);
                                            } else {
                                              setEditingSnapshotLabel(false);
                                              setPinLabelInput(snap.label ?? '');
                                              setPinDialogSnapshot(snap);
                                            }
                                          }}
                                        >
                                          <Pin
                                            size={13}
                                            weight={snap.pinned ? 'fill' : 'regular'}
                                          />
                                          <span>
                                            {snap.pinned ? 'Unpin version' : 'Pin version...'}
                                          </span>
                                        </DropdownMenu.Item>
                                        <DropdownMenu.Item
                                          className="history-menu-item"
                                          onSelect={() => {
                                            setEditingSnapshotLabel(true);
                                            setPinLabelInput(snap.label ?? '');
                                            setPinDialogSnapshot(snap);
                                          }}
                                        >
                                          <Pencil size={13} />
                                          <span>Edit version label</span>
                                        </DropdownMenu.Item>
                                        <DropdownMenu.Separator className="history-menu-divider" />
                                        <AppTooltip
                                          content={
                                            canDelete
                                              ? 'Delete snapshot'
                                              : 'Delete (save current file first)'
                                          }
                                        >
                                          <DropdownMenu.Item
                                            className="history-menu-item history-menu-delete"
                                            disabled={!canDelete || Boolean(busyAction)}

                                            onSelect={() => void handleDelete(snap)}
                                          >
                                            <Trash2 size={13} />
                                            <span>Delete snapshot</span>
                                          </DropdownMenu.Item>
                                        </AppTooltip>
                                      </DropdownMenu.Content>
                                    </DropdownMenu.Portal>
                                  </DropdownMenu.Root>
                                ) : (
                                  <div className="history-item-icons">
                                    <IconButton
                                      small={true}
                                      className={`icon-button small history-card-btn${snap.pinned ? ' is-pinned' : ''}`}
                                      label={snap.pinned ? 'Unpin snapshot' : 'Pin snapshot'}
                                      title={
                                        snap.pinned
                                          ? 'Unpin snapshot (allows retention pruning)'
                                          : 'Pin snapshot with optional label'
                                      }
                                      onClick={() => {
                                        if (snap.pinned) {
                                          void handleUnpin(snap);
                                        } else {
                                          setEditingSnapshotLabel(false);
                                          setPinLabelInput(snap.label ?? '');
                                          setPinDialogSnapshot(snap);
                                        }
                                      }}
                                    >
                                      <Pin size={13} weight={snap.pinned ? 'fill' : 'regular'} />
                                    </IconButton>
                                    <IconButton
                                      small={true}
                                      className="icon-button small history-card-btn"
                                      label="Edit version label"
                                      title="Edit version label"
                                      onClick={() => {
                                        setEditingSnapshotLabel(true);
                                        setPinLabelInput(snap.label ?? '');
                                        setPinDialogSnapshot(snap);
                                      }}
                                    >
                                      <Pencil size={13} />
                                    </IconButton>
                                    <IconButton
                                      small={true}
                                      className="icon-button small history-card-btn history-delete-btn"
                                      label={
                                        canDelete
                                          ? 'Delete snapshot'
                                          : 'Delete (save current file first)'
                                      }
                                      title={
                                        canDelete
                                          ? 'Delete snapshot'
                                          : 'Delete (save current file first)'
                                      }
                                      disabled={!canDelete || Boolean(busyAction)}
                                      onClick={() => void handleDelete(snap)}
                                    >
                                      <Trash2 size={13} />
                                    </IconButton>
                                  </div>
                                )}
                                <div className="history-item-pill-row">
                                  <AppTooltip content={`Created via ${snap.trigger}`}>
                                    <span className={`history-pill trigger-${snap.trigger}`}>
                                      {triggerLabel(snap.trigger)}
                                    </span>
                                  </AppTooltip>
                                  {snap.pinned && (
                                    <AppTooltip content={'Pinned — protected from pruning'}>
                                      <span className="history-pill pinned">Pinned</span>
                                    </AppTooltip>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
                {nextCursor && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void loadSnapshots(nextCursor)}
                  >
                    {loading ? 'Loading…' : 'Load older snapshots'}
                  </button>
                )}
              </div>
            </>
          )}
        </CollapsibleSection>

        {/* Resizer Splitter between File History and Recent Projects */}
        {historyOpen && recentsOpen && (
          <ResizableSeparator
            orientation="horizontal"
            className="writing-resizer"
            label="Recent projects height"
            value={recentsHeight}
            min={70}
            max={450}
            defaultValue={160}
            step={16}
            title="Drag or use arrow keys to resize File History and Recent Projects"
            onResize={setRecentsHeight}
            computeValueFromPointer={(event, start) => {
              return start.value + (start.y - event.clientY);
            }}
          />
        )}

        {/* Section 2: Recent Projects */}
        <CollapsibleSection
          className={`writing-section history-section ${recentsOpen ? 'expanded' : 'collapsed'}`}
          title="Recent Projects"
          id="history-recents-heading"
          icon={<FolderOpen size={13} aria-hidden="true" />}
          count={recents.length}
          open={recentsOpen}
          onOpenChange={setRecentsOpen}
          headerClassName="writing-section-toggle"
          headerRowClassName="history-recents-header-row"
          bodyClassName="writing-section-body"
          bodyStyle={{ overflowY: 'auto' }}
          style={{
            height: recentsOpen ? (historyOpen ? `${recentsHeight}px` : undefined) : '32px',
            flex: recentsOpen ? (historyOpen ? `0 0 ${recentsHeight}px` : '1 1 0') : '0 0 32px',
            minHeight: recentsOpen ? '60px' : '32px',
            maxHeight: recentsOpen ? undefined : '32px',
          }}
        >
          {recentsOpen && (
            <>
              {recents.length === 0 ? (
                <p className="writing-empty">No recent projects.</p>
              ) : (
                <div className="recent-project-list" style={{ padding: '4px 6px' }}>
                  {[...recents]
                    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                    .map((recent) => (
                      <div className="recent-row" key={recent.id}>
                        <AppTooltip content={recent.rootPath}>
                          <span className="tooltip-disabled-trigger">
                            <button
                              className="recent-open"

                              aria-label={`Open recent ${recent.name}`}
                              disabled={projectBusy}
                              onClick={() => onOpenFolder?.(recent.id)}
                            >
                              <FolderOpen size={13} />
                              <span>{recent.name}</span>
                            </button>
                          </span>
                        </AppTooltip>
                        {onPinProject && (
                          <IconButton
                            small={true}
                            className="icon-button small"
                            label={`${recent.pinned ? 'Unpin' : 'Pin'} ${recent.name}`}
                            title={`${recent.pinned ? 'Unpin' : 'Pin'} ${recent.name}`}
                            aria-pressed={recent.pinned}
                            onClick={() => void onPinProject(recent.id, !recent.pinned)}
                          >
                            <Pin size={12} weight={recent.pinned ? 'fill' : 'regular'} />
                          </IconButton>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </CollapsibleSection>
      </div>
    </div>
  );
}
