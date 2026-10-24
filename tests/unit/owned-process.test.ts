import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runOwnedProcess } from '../../src/main/services/owned-process';

const mock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mock.spawn }));

class Child extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  kill = vi.fn(() => {
    this.exitCode = -1;
    this.emit('close', -1);
    return true;
  });
}

describe('owned language processes (mock child)', () => {
  let child: Child;
  let controller: AbortController;
  const options = () => ({
    executable: 'formatter',
    args: [],
    cwd: process.cwd(),
    signal: controller.signal,
    timeoutMs: 15000,
    maxStdoutBytes: 8,
    maxStderrBytes: 4,
  });
  beforeEach(() => {
    child = new Child();
    controller = new AbortController();
    mock.spawn.mockReturnValue(child);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles an asynchronous stdin failure and rejects only once despite later close/error events', async () => {
    const pending = runOwnedProcess({ ...options(), input: 'source' });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LANGUAGE_FAILED' });
    child.stdin.emit('error', new Error('EPIPE'));
    child.stdout.emit('error', new Error('late error'));
    child.emit('close', 0);
    await rejected;
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it.each(['stdout', 'stderr'] as const)(
    'terminates when %s exceeds its byte cap',
    async (stream) => {
      const pending = runOwnedProcess(options());
      const rejected = expect(pending).rejects.toMatchObject({ code: 'LANGUAGE_OUTPUT_LIMIT' });
      child[stream].write(Buffer.from('€€€'));
      await rejected;
      expect(child.kill).toHaveBeenCalledOnce();
    },
  );

  it('does not spawn cancelled work', async () => {
    controller.abort();
    mock.spawn.mockClear();
    await expect(runOwnedProcess(options())).rejects.toMatchObject({ code: 'LANGUAGE_CANCELLED' });
    expect(mock.spawn).not.toHaveBeenCalled();
  });

  it('owns cancellation through process close and removes the deadline', async () => {
    vi.useFakeTimers();
    const pending = runOwnedProcess(options());
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LANGUAGE_CANCELLED' });
    controller.abort();
    await rejected;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('kills a process that exceeds the deadline', async () => {
    vi.useFakeTimers();
    const pending = runOwnedProcess(options());
    const rejected = expect(pending).rejects.toMatchObject({ code: 'LANGUAGE_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(child.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses descendant termination and awaits the Windows tree killer before rejecting', async () => {
    Object.defineProperty(child, 'pid', { value: 424242 });
    const killer = new Child();
    mock.spawn.mockImplementationOnce(() => child).mockImplementationOnce(() => killer);
    const killProcess = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      const pending = runOwnedProcess(options());
      const rejected = expect(pending).rejects.toMatchObject({ code: 'LANGUAGE_CANCELLED' });
      controller.abort();
      await Promise.resolve();
      if (process.platform === 'win32') {
        expect(mock.spawn).toHaveBeenLastCalledWith(
          expect.stringContaining('taskkill.exe'),
          ['/PID', '424242', '/T', '/F'],
          expect.objectContaining({ shell: false }),
        );
        killer.emit('close', 0);
      } else {
        expect(killProcess).toHaveBeenCalledWith(-424242, 'SIGKILL');
        child.emit('close', -1);
      }
      await rejected;
    } finally {
      killProcess.mockRestore();
    }
  });

  it('returns bounded UTF-8 output after normal close', async () => {
    const pending = runOwnedProcess(options());
    child.stdout.write(Buffer.from('€'));
    child.stderr.write(Buffer.from('warn'));
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({ stdout: '€', stderr: 'warn', code: 0 });
  });
});
