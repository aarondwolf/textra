/** Serializes project transitions and owns requests admitted by the active workspace. */
export class WorkspaceSession {
  private pending = new Set<Promise<unknown>>();
  private changing = false;
  private stopped = false;
  private epoch = 0;
  private transitionOperation: Promise<unknown> | null = null;

  constructor(private readonly stopResources: () => Promise<void>) {}

  get generation(): number {
    return this.epoch;
  }

  assertCurrent(generation: number): void {
    if (this.stopped || this.changing || generation !== this.epoch)
      throw new LifecycleError(
        'STALE_REQUEST',
        'The workspace changed before this operation could start.',
      );
  }

  run<T>(action: () => Promise<T> | T): Promise<T> {
    if (this.changing || this.stopped)
      return Promise.reject(
        new LifecycleError('WORKSPACE_BUSY', 'Wait for the workspace transition.'),
      );
    const operation = (async () => action())();
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => undefined);
    return operation;
  }

  transition<T>(action: () => Promise<T>): Promise<T> {
    if (this.changing || this.stopped)
      return Promise.reject(
        new LifecycleError('WORKSPACE_BUSY', 'Wait for the workspace transition.'),
      );
    this.changing = true;
    this.epoch++;
    const operation = (async () => {
      await this.stopResources();
      await this.drain();
      if (this.stopped) throw new LifecycleError('APP_CLOSING', 'The application is closing.');
      return action();
    })().finally(() => {
      this.changing = false;
      this.transitionOperation = null;
    });
    this.transitionOperation = operation;
    return operation;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.epoch++;
    await this.transitionOperation?.catch(() => undefined);
    await this.stopResources();
    await this.drain();
  }

  resume(): void {
    this.stopped = false;
  }

  private async drain(): Promise<void> {
    // A request can schedule persistence before it settles; drain requests first.
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }
}

export class LifecycleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LifecycleError';
  }
}

/** App-scoped settings keep working during project switches, but are drained on close. */
export class ApplicationTasks {
  private operations = new Set<Promise<unknown>>();
  run<T>(action: () => Promise<T> | T): Promise<T> {
    const operation = (async () => action())();
    this.operations.add(operation);
    void operation.finally(() => this.operations.delete(operation)).catch(() => undefined);
    return operation;
  }
  async drain(): Promise<void> {
    while (this.operations.size) await Promise.allSettled([...this.operations]);
  }
}

/** A normal close is permitted only after the single shared preparation has completed. */
export class ShutdownCoordinator {
  private current: Promise<boolean> | null = null;
  private complete = false;

  get ready(): boolean {
    return this.complete;
  }

  request(prepare: () => Promise<boolean>, drain: () => Promise<void>): Promise<boolean> {
    if (this.complete) return Promise.resolve(true);
    this.current ??= (async () => {
      if (!(await prepare())) return false;
      await drain();
      this.complete = true;
      return true;
    })().finally(() => {
      this.current = null;
    });
    return this.current;
  }
}

/** One bounded, request-specific renderer persistence acknowledgement. */
export class RendererCloseBarrier {
  private pending: { id: string; finish: (ready: boolean) => void } | null = null;

  wait(id: string, send: (id: string) => void, timeoutMs = 10_000): Promise<boolean> {
    this.cancel();
    return new Promise<boolean>((resolve) => {
      const finish = (ready: boolean) => {
        clearTimeout(timer);
        if (this.pending?.id === id) this.pending = null;
        resolve(ready);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.pending = { id, finish };
      try {
        send(id);
      } catch {
        finish(false);
      }
    });
  }

  acknowledge(value: unknown): void {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new LifecycleError('INVALID_ARGUMENT', 'Provide a close acknowledgement.');
    const request = value as Record<string, unknown>;
    if (
      Object.keys(request).length !== 2 ||
      typeof request.requestId !== 'string' ||
      !/^[A-Za-z0-9-]{1,64}$/.test(request.requestId) ||
      typeof request.ready !== 'boolean'
    )
      throw new LifecycleError('INVALID_ARGUMENT', 'Provide a close acknowledgement.');
    if (this.pending?.id !== request.requestId)
      throw new LifecycleError('STALE_REQUEST', 'This close request is no longer active.');
    this.pending.finish(request.ready);
  }

  cancel(): void {
    this.pending?.finish(false);
  }
}
