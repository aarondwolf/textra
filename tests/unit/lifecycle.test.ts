import { describe, expect, it, vi } from 'vitest';
import {
  ApplicationTasks,
  RendererCloseBarrier,
  ShutdownCoordinator,
  WorkspaceSession,
} from '../../src/main/lifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('application resource owners', () => {
  it('keeps app-scoped persistence available during a project switch and drains it on exit', async () => {
    const application = new ApplicationTasks();
    const cleanup = deferred<void>();
    const persistence = deferred<void>();
    const workspace = new WorkspaceSession(() => cleanup.promise);
    const transition = workspace.transition(async () => 'new project');
    const save = application.run(() => persistence.promise);
    let finished = false;
    const exiting = application.drain().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    cleanup.resolve();
    await expect(transition).resolves.toBe('new project');
    expect(finished).toBe(false);
    persistence.resolve();
    await save;
    await exiting;
    expect(finished).toBe(true);
  });
  it('rejects a delayed resource start after transition cancellation has begun', async () => {
    const preflight = deferred<void>();
    const start = vi.fn();
    const owner = new WorkspaceSession(async () => undefined);
    const generation = owner.generation;
    const request = owner.run(async () => {
      await preflight.promise;
      owner.assertCurrent(generation);
      start();
    });
    const rejected = expect(request).rejects.toMatchObject({ code: 'STALE_REQUEST' });
    const transition = owner.transition(async () => 'new project');
    preflight.resolve();
    await rejected;
    await expect(transition).resolves.toBe('new project');
    expect(start).not.toHaveBeenCalled();
  });
  it('drains admitted operations before switching and rejects new work meanwhile', async () => {
    const work = deferred<string>();
    const order: string[] = [];
    const owner = new WorkspaceSession(async () => {
      order.push('stop');
    });
    const running = owner.run(() => work.promise);
    const transition = owner.transition(async () => {
      order.push('open');
      return 'new';
    });
    await expect(owner.run(() => 'late')).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
    expect(order).toEqual(['stop']);
    work.resolve('old');
    await expect(running).resolves.toBe('old');
    await expect(transition).resolves.toBe('new');
    expect(order).toEqual(['stop', 'open']);
    expect(owner.generation).toBe(1);
    await expect(owner.run(() => 'current')).resolves.toBe('current');
  });

  it('recovers admission after a failed transition and supports macOS window recreation', async () => {
    const stop = vi.fn(async () => undefined);
    const owner = new WorkspaceSession(stop);
    await expect(
      owner.transition(async () => {
        throw Error('failed');
      }),
    ).rejects.toThrow('failed');
    await expect(owner.run(() => 'preserved')).resolves.toBe('preserved');
    await owner.stop();
    await expect(owner.run(() => 'closed')).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
    owner.resume();
    await expect(owner.run(() => 'reopened')).resolves.toBe('reopened');
  });

  it('coalesces repeated close attempts and permits close only after persistence drains', async () => {
    const owner = new ShutdownCoordinator();
    const ready = deferred<boolean>();
    const drained = deferred<void>();
    const prepare = vi.fn(() => ready.promise);
    const drain = vi.fn(() => drained.promise);
    const first = owner.request(prepare, drain);
    expect(owner.request(prepare, drain)).toBe(first);
    expect(owner.ready).toBe(false);
    ready.resolve(true);
    await Promise.resolve();
    expect(drain).toHaveBeenCalledOnce();
    expect(owner.ready).toBe(false);
    drained.resolve();
    await expect(first).resolves.toBe(true);
    expect(owner.ready).toBe(true);
    expect(prepare).toHaveBeenCalledOnce();
  });

  it('allows retry after cancellation or cleanup failure', async () => {
    const owner = new ShutdownCoordinator();
    const drain = vi.fn(async () => undefined);
    await expect(owner.request(async () => false, drain)).resolves.toBe(false);
    expect(drain).not.toHaveBeenCalled();
    await expect(
      owner.request(
        async () => true,
        async () => {
          throw Error('disk');
        },
      ),
    ).rejects.toThrow('disk');
    expect(owner.ready).toBe(false);
    await expect(owner.request(async () => true, drain)).resolves.toBe(true);
  });

  it('requires the current renderer acknowledgement and fails closed on timeout', async () => {
    vi.useFakeTimers();
    try {
      const barrier = new RendererCloseBarrier();
      const send = vi.fn();
      const first = barrier.wait('first', send);
      expect(send).toHaveBeenCalledWith('first');
      expect(() => barrier.acknowledge({ requestId: 'other', ready: true })).toThrow();
      expect(() => barrier.acknowledge({ requestId: 'first', ready: true, extra: true })).toThrow();
      barrier.acknowledge({ requestId: 'first', ready: true });
      await expect(first).resolves.toBe(true);
      const second = barrier.wait('second', send);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(second).resolves.toBe(false);
      expect(() => barrier.acknowledge({ requestId: 'second', ready: true })).toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
