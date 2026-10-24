/**
 * AsyncMutex ensures asynchronous operations execute strictly in sequential FIFO order.
 * If an enqueued operation throws or rejects, subsequent operations still execute normally.
 */
export class AsyncMutex {
  private pending: Promise<unknown> = Promise.resolve();

  /**
   * Enqueues an asynchronous action to run after all currently queued actions finish.
   * Resolves or rejects with the outcome of `action`.
   */
  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.catch(() => undefined).then(action);
    this.pending = result;
    return result;
  }

  /**
   * Waits for all currently queued actions to settle (whether resolved or rejected).
   */
  async flush(): Promise<void> {
    await this.pending.catch(() => undefined);
  }
}
