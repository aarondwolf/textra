import * as Y from 'yjs';

const INITIAL_ORIGIN = Symbol('initial-state');
export const REMOTE_ORIGIN = Symbol('remote-update');

/** One open `.tex` file: editable local state and accepted shared state stay separate. */
export class CollaborationSession {
  readonly initializationId: string;
  readonly shared = new Y.Doc();
  local = new Y.Doc();
  readonly sharedText = this.shared.getText('source');
  localText = this.local.getText('source');
  undoManager: Y.UndoManager;

  constructor(
    content: string,
    initialStates: readonly Uint8Array[] = [],
    initializationId?: string,
  ) {
    this.initializationId = initializationId ?? crypto.randomUUID();
    if (initialStates.length) {
      for (const state of initialStates) Y.applyUpdate(this.shared, state, REMOTE_ORIGIN);
      if (this.sharedText.toString() !== content)
        throw new Error('The saved collaboration state does not match the current .tex file.');
    } else this.shared.transact(() => this.sharedText.insert(0, content), INITIAL_ORIGIN);
    Y.applyUpdate(this.local, Y.encodeStateAsUpdate(this.shared), INITIAL_ORIGIN);
    this.localText = this.local.getText('source');
    this.undoManager = this.createUndoManager();
  }

  private createUndoManager(): Y.UndoManager {
    return new Y.UndoManager(this.localText, {
      trackedOrigins: new Set([null]),
      captureTimeout: 500,
    });
  }

  trackEditorBinding(binding: object): void {
    this.undoManager.trackedOrigins.add(binding);
  }

  /** Incoming records update accepted state and the editor, with no local undo entry. */
  applyIncoming(update: Uint8Array): void {
    Y.applyUpdate(this.shared, update, REMOTE_ORIGIN);
    Y.applyUpdate(this.local, update, REMOTE_ORIGIN);
  }

  /** Capture exactly the current editor state; later local typing cannot mutate these bytes. */
  captureForSave(): { text: string; update: Uint8Array; state: Uint8Array } {
    const text = this.localText.toString();
    const update = Y.encodeStateAsUpdate(this.local, Y.encodeStateVector(this.shared));
    const state = Y.encodeStateAsUpdate(this.local);
    return { text, update, state };
  }

  acknowledgeSaved(state: Uint8Array): void {
    Y.applyUpdate(this.shared, state, REMOTE_ORIGIN);
  }

  /** Discard unpublished local operations while retaining all accepted shared operations. */
  discardLocal(): void {
    this.undoManager.destroy();
    this.local.destroy();
    this.local = new Y.Doc();
    Y.applyUpdate(this.local, Y.encodeStateAsUpdate(this.shared), REMOTE_ORIGIN);
    this.localText = this.local.getText('source');
    this.undoManager = this.createUndoManager();
  }

  destroy(): void {
    this.undoManager.destroy();
    this.local.destroy();
    this.shared.destroy();
  }
}

export function mergeUpdateIntoDocument(state: Uint8Array, update: Uint8Array): Uint8Array {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state, REMOTE_ORIGIN);
    Y.applyUpdate(doc, update, REMOTE_ORIGIN);
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}
