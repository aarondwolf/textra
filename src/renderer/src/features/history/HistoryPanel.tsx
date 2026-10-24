import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { HistorySnapshotSummary, LegacyHistorySummary } from '../../../../shared/api';
import { useHistorySnapshots } from './useHistorySnapshots';
import { beginHistoryResize } from './history-resize';
import { PaneHeader } from '../../components/Layout';
import { IconButton } from '../../components/Button';
import {
  ChevronDown,
  ChevronRight,
  History,
  FolderOpen,
  RefreshCw,
  Plus,
  Pin,
  Undo2,
  Columns2,
  ArrowSquareOut,
  Trash2,
  X,
  Check,
  Ellipsis,
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
  onRestoreSnapshot: (snapshot: HistorySnapshotSummary) => Promise<void>;
  onExportSnapshot: (snapshot: HistorySnapshotSummary) => Promise<void>;
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
  projectName = 'the current project',
  activePath,
  isDirty = false,
  selectedSnapshotId,
  onCompareSnapshot,
  onRestoreSnapshot,
  onExportSnapshot,
  onDeleteSnapshot,
  onPinSnapshot,
  onCreateSnapshot,
  recents = [],
  onOpenFolder,
  onPinProject,
  projectBusy = false,
}: HistoryPanelProps) {
  const {
    snapshots,
    nextCursor,
    loading,
    error: historyError,
    loadSnapshots,
  } = useHistorySnapshots(projectId, activePath);
  const [legacyHistories, setLegacyHistories] = useState<LegacyHistorySummary[] | null>(null);
  const [recoveryError, setRecoveryError] = useState('');
  const recoveryGeneration = useRef({ value: 0 });
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pinDialogSnapshot, setPinDialogSnapshot] = useState<HistorySnapshotSummary | null>(null);
  const [pinLabelInput, setPinLabelInput] = useState('');
  const [manualSnapshotPrompt, setManualSnapshotPrompt] = useState(false);
  const [manualLabelInput, setManualLabelInput] = useState('');

  const [historyOpen, setHistoryOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [recentsHeight, setRecentsHeight] = useState(160);
  const dragLifetime = useRef({ cleanup: () => {} });

  const sidebarRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  useEffect(() => {
    const owner = dragLifetime.current;
    return () => owner.cleanup();
  }, []);

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
    if (!activeMenuId) return;
    const handleDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.history-action-menu')) return;
      setActiveMenuId(null);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenuId(null);
    };
    window.addEventListener('mousedown', handleDown);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleDown);
      window.removeEventListener('keydown', handleKey);
    };
  }, [activeMenuId]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragLifetime.current.cleanup();
      e.preventDefault();
      dragLifetime.current.cleanup = beginHistoryResize(e.clientY, recentsHeight, setRecentsHeight);
    },
    [recentsHeight],
  );

  useEffect(() => {
    const owner = recoveryGeneration.current;
    setLegacyHistories(null);
    setRecoveryError('');
    return () => {
      owner.value++;
    };
  }, [projectId]);

  async function discoverLegacyHistory() {
    if (!projectId) return;
    const generation = ++recoveryGeneration.current.value;
    setRecoveryError('');
    try {
      const result = await window.textra.listLegacyFileHistories(projectId);
      if (generation !== recoveryGeneration.current.value || currentProject.current !== projectId)
        return;
      if (!result.ok) throw new Error(result.error);
      setLegacyHistories(result.value);
    } catch (cause) {
      if (generation === recoveryGeneration.current.value && currentProject.current === projectId)
        setRecoveryError(
          cause instanceof Error ? cause.message : 'Could not find earlier history.',
        );
    }
  }

  async function recoverLegacyHistory(history: LegacyHistorySummary) {
    if (!projectId || busyAction) return;
    const generation = recoveryGeneration.current.value;
    setBusyAction('recover-history');
    try {
      const result = await window.textra.importLegacyFileHistory({
        projectId,
        legacyId: history.id,
      });
      if (generation !== recoveryGeneration.current.value || currentProject.current !== projectId)
        return;
      if (!result.ok) throw new Error(result.error);
      if (result.value === 0) return;
      setLegacyHistories((previous) => previous?.filter((item) => item.id !== history.id) ?? null);
      await loadSnapshots();
    } catch (cause) {
      if (generation === recoveryGeneration.current.value && currentProject.current === projectId)
        setRecoveryError(
          cause instanceof Error ? cause.message : 'Could not recover earlier history.',
        );
    } finally {
      if (generation === recoveryGeneration.current.value && currentProject.current === projectId)
        setBusyAction(null);
    }
  }

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
        {projectId && (
          <div className="history-prompt-card">
            <button
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => void discoverLegacyHistory()}
            >
              Recover earlier history…
            </button>
            {legacyHistories && (
              <div aria-label="Earlier history stores">
                <p>Choose an earlier history store belonging to {projectName}.</p>
                {legacyHistories.length === 0 && <p>No earlier history stores found.</p>}
                {legacyHistories.map((history) => (
                  <button
                    key={history.id}
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => void recoverLegacyHistory(history)}
                  >
                    {history.snapshotCount} snapshots · {history.samplePaths.join(', ')} (
                    {history.id})
                  </button>
                ))}
              </div>
            )}
            {recoveryError && <p role="alert">{recoveryError}</p>}
          </div>
        )}
        {/* Section 1: File History */}
        <section
          className={`writing-section history-section ${historyOpen ? 'expanded' : 'collapsed'}`}
          aria-labelledby="history-snapshots-heading"
          style={{
            flex: historyOpen ? '1 1 0' : '0 0 32px',
            height: historyOpen ? undefined : '32px',
            minHeight: historyOpen ? '80px' : '32px',
            maxHeight: historyOpen ? undefined : '32px',
          }}
        >
          <div className="history-section-header">
            <button
              type="button"
              className="writing-section-toggle"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              {historyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span id="history-snapshots-heading" className="writing-section-title-text">
                <History size={13} aria-hidden="true" />
                File History
              </span>
              {fileName && (
                <span className="history-header-filename" title={activePath ?? undefined}>
                  {fileName}
                </span>
              )}
              <span className="writing-count">{snapshots.length}</span>
            </button>
            {historyOpen && activePath && (
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
            )}
          </div>

          {historyOpen && (
            <div className="history-section-body">
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
                    Pin version ({formatTime(pinDialogSnapshot.createdAt)}):
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
                      Pin
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
                  <div className="history-empty">
                    <History size={28} weight="thin" />
                    <p>No document selected</p>
                    <span>
                      Open a file in your project to view its automatic historical snapshots.
                    </span>
                  </div>
                ) : loading && snapshots.length === 0 ? (
                  <div className="history-empty">
                    <RefreshCw size={24} weight="thin" className="conflict-orbit" />
                    <p>Loading history…</p>
                  </div>
                ) : snapshots.length === 0 ? (
                  <div className="history-empty">
                    <History size={28} weight="thin" />
                    <p>No snapshots yet</p>
                    <span>
                      Snapshots are created automatically when saving, compiling, or after intervals
                      of editing.
                    </span>
                  </div>
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
                            onClick={() => onCompareSnapshot(snap)}
                          >
                            <div className="history-item-top">
                              <div className="history-item-info">
                                <span className="history-item-time" title={snap.createdAt}>
                                  {formatTime(snap.createdAt)}
                                </span>
                                {snap.label && (
                                  <span className="history-item-label" title={snap.label}>
                                    {snap.label}
                                  </span>
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
                                  <div style={{ position: 'relative' }}>
                                    <IconButton
                                      small={true}
                                      className="icon-button small history-card-btn"
                                      label="Snapshot actions"
                                      title="Snapshot actions"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveMenuId(activeMenuId === snap.id ? null : snap.id);
                                      }}
                                    >
                                      <Ellipsis size={15} weight="bold" />
                                    </IconButton>
                                    {activeMenuId === snap.id && (
                                      <div
                                        className="history-action-menu"
                                        role="menu"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          className="history-menu-item"
                                          onClick={() => {
                                            setActiveMenuId(null);
                                            onCompareSnapshot(snap);
                                          }}
                                        >
                                          <Columns2 size={13} />
                                          <span>Compare with current file</span>
                                        </button>
                                        <button
                                          type="button"
                                          className={`history-menu-item${snap.pinned ? ' is-pinned' : ''}`}
                                          onClick={() => {
                                            setActiveMenuId(null);
                                            if (snap.pinned) {
                                              void handleUnpin(snap);
                                            } else {
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
                                        </button>
                                        <button
                                          type="button"
                                          className="history-menu-item"
                                          onClick={() => {
                                            setActiveMenuId(null);
                                            void onRestoreSnapshot(snap);
                                          }}
                                        >
                                          <Undo2 size={13} />
                                          <span>Restore version</span>
                                        </button>
                                        <button
                                          type="button"
                                          className="history-menu-item"
                                          onClick={() => {
                                            setActiveMenuId(null);
                                            void onExportSnapshot(snap);
                                          }}
                                        >
                                          <ArrowSquareOut size={13} />
                                          <span>Export version...</span>
                                        </button>
                                        <div className="history-menu-divider" />
                                        <button
                                          type="button"
                                          className="history-menu-item history-menu-delete"
                                          disabled={!canDelete || Boolean(busyAction)}
                                          title={
                                            canDelete
                                              ? 'Delete snapshot'
                                              : 'Delete (save current file first)'
                                          }
                                          onClick={() => {
                                            setActiveMenuId(null);
                                            void handleDelete(snap);
                                          }}
                                        >
                                          <Trash2 size={13} />
                                          <span>Delete snapshot</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="history-item-icons">
                                    <IconButton
                                      small={true}
                                      className="icon-button small history-card-btn"
                                      label="Compare snapshot"
                                      title="Compare side-by-side with current file"
                                      onClick={() => onCompareSnapshot(snap)}
                                    >
                                      <Columns2 size={13} />
                                    </IconButton>
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
                                      label="Restore snapshot"
                                      title="Restore this snapshot to disk"
                                      onClick={() => void onRestoreSnapshot(snap)}
                                    >
                                      <Undo2 size={13} />
                                    </IconButton>
                                    <IconButton
                                      small={true}
                                      className="icon-button small history-card-btn"
                                      label="Export snapshot"
                                      title="Export snapshot to a file"
                                      onClick={() => void onExportSnapshot(snap)}
                                    >
                                      <ArrowSquareOut size={13} />
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
                                  <span
                                    className={`history-pill trigger-${snap.trigger}`}
                                    title={`Created via ${snap.trigger}`}
                                  >
                                    {triggerLabel(snap.trigger)}
                                  </span>
                                  {snap.pinned && (
                                    <span
                                      className="history-pill pinned"
                                      title="Pinned — protected from pruning"
                                    >
                                      Pinned
                                    </span>
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
            </div>
          )}
        </section>

        {/* Resizer Splitter between File History and Recent Projects */}
        {historyOpen && recentsOpen && (
          <div
            className="writing-resizer"
            onMouseDown={onMouseDown}
            role="separator"
            aria-orientation="horizontal"
            title="Drag to resize File History and Recent Projects"
          />
        )}

        {/* Section 2: Recent Projects */}
        <section
          className={`writing-section history-section ${recentsOpen ? 'expanded' : 'collapsed'}`}
          aria-labelledby="history-recents-heading"
          style={{
            height: recentsOpen ? (historyOpen ? `${recentsHeight}px` : undefined) : '32px',
            flex: recentsOpen ? (historyOpen ? `0 0 ${recentsHeight}px` : '1 1 0') : '0 0 32px',
            minHeight: recentsOpen ? '60px' : '32px',
            maxHeight: recentsOpen ? undefined : '32px',
          }}
        >
          <button
            type="button"
            className="writing-section-toggle"
            aria-expanded={recentsOpen}
            onClick={() => setRecentsOpen((open) => !open)}
          >
            {recentsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span id="history-recents-heading" className="writing-section-title-text">
              <FolderOpen size={13} aria-hidden="true" />
              Recent Projects
            </span>
            <span className="writing-count">{recents.length}</span>
          </button>

          {recentsOpen && (
            <div className="writing-section-body" style={{ overflowY: 'auto' }}>
              {recents.length === 0 ? (
                <p className="writing-empty">No recent projects.</p>
              ) : (
                <div className="recent-project-list" style={{ padding: '4px 6px' }}>
                  {[...recents]
                    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                    .map((recent) => (
                      <div className="recent-row" key={recent.id}>
                        <button
                          className="recent-open"
                          title={recent.rootPath}
                          aria-label={`Open recent ${recent.name}`}
                          disabled={projectBusy}
                          onClick={() => onOpenFolder?.(recent.id)}
                        >
                          <FolderOpen size={13} />
                          <span>{recent.name}</span>
                        </button>
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
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
