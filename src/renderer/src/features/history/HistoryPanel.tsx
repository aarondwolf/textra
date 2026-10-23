import { useEffect, useState, useCallback, useMemo } from 'react';
import type { HistorySnapshotSummary } from '../../../../shared/api';
import { PaneHeader } from '../../components/Layout';
import { IconButton } from '../../components/Button';
import {
  History,
  RefreshCw,
  Plus,
  Pin,
  Undo2,
  Columns2,
  ArrowSquareOut,
  X,
  Check,
} from '../../icons';
import './history.css';

export interface HistoryPanelProps {
  projectId: string | null;
  activePath: string | null;
  activeContent?: string;
  selectedSnapshotId?: string | null;
  onCompareSnapshot: (snapshot: HistorySnapshotSummary) => void;
  onRestoreSnapshot: (snapshot: HistorySnapshotSummary) => Promise<void>;
  onExportSnapshot: (snapshot: HistorySnapshotSummary) => Promise<void>;
  onPinSnapshot: (
    snapshot: HistorySnapshotSummary,
    pinned: boolean,
    label?: string | null,
  ) => Promise<void>;
  onCreateSnapshot?: (label?: string) => Promise<void>;
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
  selectedSnapshotId,
  onCompareSnapshot,
  onRestoreSnapshot,
  onExportSnapshot,
  onPinSnapshot,
  onCreateSnapshot,
}: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<HistorySnapshotSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [pinDialogSnapshot, setPinDialogSnapshot] = useState<HistorySnapshotSummary | null>(null);
  const [pinLabelInput, setPinLabelInput] = useState('');
  const [manualSnapshotPrompt, setManualSnapshotPrompt] = useState(false);
  const [manualLabelInput, setManualLabelInput] = useState('');

  const loadSnapshots = useCallback(async () => {
    if (!projectId || !activePath) {
      setSnapshots([]);
      return;
    }
    setLoading(true);
    try {
      const res = await window.textra.listFileHistory({ projectId, path: activePath });
      if (res.ok) {
        setSnapshots(res.value);
      } else {
        setSnapshots([]);
      }
    } catch {
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, activePath]);

  useEffect(() => {
    void loadSnapshots();
  }, [loadSnapshots]);

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
    const yesterdayMidnight = todayMidnight - 24 * 60 * 60 * 1000;
    const weekAgoMidnight = todayMidnight - 7 * 24 * 60 * 60 * 1000;

    const pinned: HistorySnapshotSummary[] = [];
    const today: HistorySnapshotSummary[] = [];
    const yesterday: HistorySnapshotSummary[] = [];
    const thisWeek: HistorySnapshotSummary[] = [];
    const older: HistorySnapshotSummary[] = [];

    for (const snap of snapshots) {
      if (snap.pinned || snap.label) {
        pinned.push(snap);
      }
      const time = new Date(snap.createdAt).getTime();
      if (time >= todayMidnight) {
        today.push(snap);
      } else if (time >= yesterdayMidnight) {
        yesterday.push(snap);
      } else if (time >= weekAgoMidnight) {
        thisWeek.push(snap);
      } else {
        older.push(snap);
      }
    }

    const result: { title: string; items: HistorySnapshotSummary[] }[] = [];
    if (pinned.length > 0) result.push({ title: 'Pinned Versions', items: pinned });
    if (today.length > 0) result.push({ title: 'Today', items: today });
    if (yesterday.length > 0) result.push({ title: 'Yesterday', items: yesterday });
    if (thisWeek.length > 0) result.push({ title: 'Earlier this week', items: thisWeek });
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

  const fileName = activePath ? activePath.split('/').pop() : null;

  return (
    <div className="history-sidebar">
      <PaneHeader
        title="File History"
        className="sidebar-title"
        actions={
          <div className="inline-actions">
            {activePath && (
              <IconButton
                small={true}
                className="icon-button small"
                label="Create snapshot now"
                title="Create a snapshot of the current document"
                disabled={loading || Boolean(busyAction)}
                onClick={() => setManualSnapshotPrompt(true)}
              >
                <Plus size={15} />
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

      {activePath && (
        <div className="history-active-file" title={activePath}>
          <History size={14} />
          <span>
            File: <strong>{fileName}</strong>
          </span>
        </div>
      )}

      {manualSnapshotPrompt && (
        <div
          className="history-active-file"
          style={{ flexDirection: 'column', gap: 6, padding: '8px 12px' }}
        >
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
        <div
          className="history-active-file"
          style={{ flexDirection: 'column', gap: 6, padding: '8px 12px' }}
        >
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
        {!activePath ? (
          <div className="history-empty">
            <History size={28} weight="thin" />
            <p>No document selected</p>
            <span>Open a file in your project to view its automatic historical snapshots.</span>
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
              Snapshots are created automatically when saving, compiling, or after intervals of
              editing.
            </span>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.title} className="history-group">
              <div className="history-group-title">{group.title}</div>
              {group.items.map((snap) => {
                const isSelected = selectedSnapshotId === snap.id;
                return (
                  <div
                    key={`${group.title}-${snap.id}`}
                    className={`history-item${isSelected ? ' is-selected' : ''}`}
                    onClick={() => onCompareSnapshot(snap)}
                  >
                    <div className="history-item-header">
                      <span className="history-item-time" title={snap.createdAt}>
                        {formatTime(snap.createdAt)}
                      </span>
                      <div className="history-item-tags">
                        <span
                          className={`history-badge trigger-${snap.trigger}`}
                          title={`Created via ${snap.trigger}`}
                        >
                          {triggerLabel(snap.trigger)}
                        </span>
                        {snap.pinned && (
                          <span
                            className="history-badge pinned"
                            title="Pinned — protected from pruning"
                          >
                            <Pin size={10} weight="fill" />
                            Pinned
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="history-item-meta">
                      {snap.label && (
                        <span className="history-item-label" title={snap.label}>
                          “{snap.label}”
                        </span>
                      )}
                      <span>{formatDate(snap.createdAt)}</span>
                      <span>•</span>
                      <span>{formatBytes(snap.sizeBytes)}</span>
                    </div>

                    <div className="history-item-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        title="Compare side-by-side with current file"
                        onClick={() => onCompareSnapshot(snap)}
                      >
                        <Columns2 size={12} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                        Compare
                      </button>
                      {snap.pinned ? (
                        <button
                          type="button"
                          title="Unpin snapshot (allows pruning after retention period)"
                          onClick={() => void handleUnpin(snap)}
                        >
                          Unpin
                        </button>
                      ) : (
                        <button
                          type="button"
                          title="Pin snapshot with an optional label"
                          onClick={() => {
                            setPinLabelInput(snap.label ?? '');
                            setPinDialogSnapshot(snap);
                          }}
                        >
                          <Pin size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                          Pin
                        </button>
                      )}
                      <button
                        type="button"
                        className="restore-btn"
                        title="Restore this snapshot to disk"
                        onClick={() => void onRestoreSnapshot(snap)}
                      >
                        <Undo2 size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                        Restore
                      </button>
                      <button
                        type="button"
                        title="Export snapshot to a file"
                        onClick={() => void onExportSnapshot(snap)}
                      >
                        <ArrowSquareOut
                          size={11}
                          style={{ verticalAlign: 'middle', marginRight: 2 }}
                        />
                        Export
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
