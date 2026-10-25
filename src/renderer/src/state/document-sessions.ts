/** Main owns disk revisions; this controller owns the lifetime/version of open buffers. */
export interface DocumentBuffer {
  projectId: string;
  path: string;
  content: string;
  revision: string;
}
export interface DocumentCapture extends DocumentBuffer {
  version: number;
  lifetime: number;
}
export interface AttachedDocumentModel {
  read(): string;
  /** Replace undoably, suppressing the editor's user-change handler for this operation. */
  replace(content: string): void;
}
interface Session {
  capture: DocumentCapture;
  model?: AttachedDocumentModel;
  collaboration?: import('./collaboration-session').CollaborationSession;
}
const key = (projectId: string, path: string) => `${projectId}\0${path}`;

export class DocumentSessionController {
  locked = false;
  private sessions = new Map<string, Session>();
  private version = 0;
  private saves = new Map<string, { requested: boolean; operation: Promise<boolean> }>();

  /** One disk write per document at a time; subsequent requests use the next fresh snapshot. */
  save(projectId: string, path: string, write: () => Promise<boolean>): Promise<boolean> {
    const id = key(projectId, path);
    const existing = this.saves.get(id);
    if (existing) {
      existing.requested = true;
      return existing.operation;
    }
    let finish!: (saved: boolean) => void;
    let fail!: (error: unknown) => void;
    const operation = new Promise<boolean>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const slot = { requested: false, operation };
    this.saves.set(id, slot);
    void (async () => {
      try {
        do {
          slot.requested = false;
          if (!(await write())) return false;
        } while (slot.requested);
        return true;
      } finally {
        if (this.saves.get(id) === slot) this.saves.delete(id);
      }
    })().then(finish, fail);
    return operation;
  }

  async savesSettled(): Promise<void> {
    while (this.saves.size) {
      const results = await Promise.all([...this.saves.values()].map((slot) => slot.operation));
      if (results.some((saved) => !saved)) throw new Error('An open document could not be saved.');
    }
  }

  observe(documents: readonly DocumentBuffer[], reconcileModels = false): void {
    const open = new Set<string>();
    for (const document of documents) {
      const id = key(document.projectId, document.path);
      open.add(id);
      let session = this.sessions.get(id);
      let changed = false;
      if (!session) {
        const version = ++this.version;
        session = { capture: { ...document, version, lifetime: version } };
        this.sessions.set(id, session);
        changed = true;
      } else if (
        session.capture.content !== document.content ||
        session.capture.revision !== document.revision
      ) {
        session.capture = {
          ...document,
          version: ++this.version,
          lifetime: session.capture.lifetime,
        };
        changed = true;
      }
      if (
        (changed || reconcileModels) &&
        session.model &&
        session.model.read() !== document.content
      )
        session.model.replace(document.content);
    }
    for (const [id, session] of this.sessions) {
      if (!open.has(id)) {
        session.collaboration?.destroy();
        this.sessions.delete(id);
      }
    }
  }

  capture(projectId: string, path: string): DocumentCapture | null {
    const capture = this.sessions.get(key(projectId, path))?.capture;
    return capture ? { ...capture } : null;
  }

  matches(capture: DocumentCapture): boolean {
    return (
      this.sessions.get(key(capture.projectId, capture.path))?.capture.version === capture.version
    );
  }

  owns(capture: DocumentCapture): boolean {
    return (
      this.sessions.get(key(capture.projectId, capture.path))?.capture.lifetime === capture.lifetime
    );
  }

  collaborationFor(
    projectId: string,
    path: string,
  ): import('./collaboration-session').CollaborationSession | null {
    return this.sessions.get(key(projectId, path))?.collaboration ?? null;
  }

  discardCollaborationLocals(): void {
    for (const session of this.sessions.values()) session.collaboration?.discardLocal();
  }

  async collaboration(
    projectId: string,
    path: string,
    initialStates: readonly Uint8Array[] = [],
    initializationId?: string,
  ): Promise<import('./collaboration-session').CollaborationSession> {
    const id = key(projectId, path);
    const session = this.sessions.get(id);
    if (!session) throw new Error('The document is no longer open.');
    if (session.collaboration) return session.collaboration;
    const capture = { ...session.capture };
    const { CollaborationSession } = await import('./collaboration-session');
    if (!this.owns(capture))
      throw new Error('The document changed while collaboration was opening.');
    const collaboration = new CollaborationSession(
      capture.content,
      initialStates,
      initializationId,
    );
    const current = this.sessions.get(id);
    if (!current || current.capture.lifetime !== capture.lifetime) {
      collaboration.destroy();
      throw new Error('The document is no longer open.');
    }
    current.collaboration ??= collaboration;
    if (current.collaboration !== collaboration) collaboration.destroy();
    return current.collaboration;
  }

  attach(projectId: string, path: string, model: AttachedDocumentModel): () => void {
    const id = key(projectId, path);
    const session = this.sessions.get(id);
    if (!session) throw new Error('The document is no longer open.');
    session.model = model;
    if (model.read() !== session.capture.content) model.replace(session.capture.content);
    return () => {
      if (this.sessions.get(id)?.model === model) delete session.model;
    };
  }
}

export const documentSessions = new DocumentSessionController();
