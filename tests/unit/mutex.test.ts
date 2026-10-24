import { describe, expect, it } from 'vitest';
import { AsyncMutex } from '../../src/main/services/mutex';

describe('AsyncMutex', () => {
  it('executes tasks sequentially in FIFO order', async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    const p1 = mutex.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(1);
      return 'first';
    });

    const p2 = mutex.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(2);
      return 'second';
    });

    const p3 = mutex.run(async () => {
      order.push(3);
      return 'third';
    });

    const results = await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual(['first', 'second', 'third']);
  });

  it('continues executing subsequent tasks after a rejected task', async () => {
    const mutex = new AsyncMutex();
    const order: string[] = [];

    const p1 = mutex.run(async () => {
      order.push('step1');
      throw new Error('boom');
    });

    const p2 = mutex.run(async () => {
      order.push('step2');
      return 'ok';
    });

    await expect(p1).rejects.toThrow('boom');
    const result = await p2;

    expect(result).toBe('ok');
    expect(order).toEqual(['step1', 'step2']);
  });

  it('flush waits for all pending tasks to complete', async () => {
    const mutex = new AsyncMutex();
    let completed = false;

    void mutex.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      completed = true;
    });

    expect(completed).toBe(false);
    await mutex.flush();
    expect(completed).toBe(true);
  });
});
