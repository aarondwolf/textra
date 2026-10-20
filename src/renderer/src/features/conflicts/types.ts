import type { Theme } from '../../../../shared/api';

/** The renderer-only portion of an open document needed by the conflict UI. */
export interface ConflictDocument {
  projectId: string;
  path: string;
  content: string;
  savedContent: string;
  revision: string;
}

export type ExternalFileState = 'changing' | 'stable' | 'missing' | 'renamed';

/**
 * Stability information is deliberately supplied by the workspace watcher.  The
 * dialog does not poll or inspect paths itself, keeping filesystem access in main.
 */
export interface ExternalChangeStatus {
  state: ExternalFileState;
  quietForMs?: number;
  quietPeriodMs?: number;
  detail?: string;
}

export interface PreserveConflictOptions {
  /** Open the read-only comparison after the external side has settled. */
  compareWhenStable: boolean;
}

export interface ConflictDiffData {
  document: Pick<ConflictDocument, 'path' | 'content'>;
  /** The current text read through the narrow main-process API. */
  externalContent: string | null;
  external: ExternalChangeStatus;
  theme: Theme;
  /** A saved sibling copy, when comparison follows a preserve action. */
  snapshotPath?: string;
}
