import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

export class OwnedProcessError extends Error {
  constructor(
    readonly code:
      'LANGUAGE_CANCELLED' | 'LANGUAGE_TIMEOUT' | 'LANGUAGE_OUTPUT_LIMIT' | 'LANGUAGE_FAILED',
    message: string,
  ) {
    super(message);
  }
}

/** Terminate descendants too; formatters and TeX tools may launch interpreters. */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  // A detached POSIX group may still own inherited pipes after its leader exits.
  if (process.platform === 'win32' && child.exitCode !== null && child.exitCode !== undefined)
    return;
  if (process.platform === 'win32' && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { shell: false, windowsHide: true, stdio: 'ignore' },
      );
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (child.exitCode === null) child.kill();
        resolve();
      };
      const timer = setTimeout(() => {
        killer.kill();
        done();
      }, 2000);
      killer.once('error', done);
      killer.once('close', done);
    });
  } else if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  } else child.kill();
}

export interface OwnedProcessOptions {
  executable: string;
  args: string[];
  cwd: string;
  input?: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}

/** Owns streams, deadline and termination until close (or bounded forced teardown). */
export function runOwnedProcess(
  options: OwnedProcessOptions,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new OwnedProcessError('LANGUAGE_CANCELLED', 'Language request cancelled.'));
      return;
    }
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: OwnedProcessError | null = null;
    let settled = false;
    let forced: NodeJS.Timeout | undefined;
    let termination: Promise<void> = Promise.resolve();
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(forced);
      options.signal.removeEventListener('abort', abort);
      if (failure) void termination.then(() => reject(failure));
      else
        resolve({
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          code: code ?? -1,
        });
    };
    const fail = (error: OwnedProcessError) => {
      if (failure || settled) return;
      failure = error;
      termination = Promise.resolve()
        .then(() => terminateProcessTree(child))
        .catch(() => undefined);
      void termination.then(() => {
        if (settled) return;
        forced = setTimeout(() => {
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          finish(null);
        }, 2000);
      });
    };
    const abort = () =>
      fail(new OwnedProcessError('LANGUAGE_CANCELLED', 'Language request cancelled.'));
    const deadline = setTimeout(
      () =>
        fail(
          new OwnedProcessError(
            'LANGUAGE_TIMEOUT',
            'The language tool timed out after 15 seconds.',
          ),
        ),
      options.timeoutMs,
    );
    const streamFailure = () =>
      fail(new OwnedProcessError('LANGUAGE_FAILED', 'The language tool stream failed.'));
    child.on('error', streamFailure);
    child.stdin.on('error', streamFailure);
    child.stdout.on('error', streamFailure);
    child.stderr.on('error', streamFailure);
    child.stdout.on('data', (chunk: Buffer) => {
      if (failure || settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > options.maxStdoutBytes)
        fail(
          new OwnedProcessError(
            'LANGUAGE_OUTPUT_LIMIT',
            'Language tool output exceeded its size limit.',
          ),
        );
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (failure || settled) return;
      stderrBytes += chunk.length;
      if (stderrBytes > options.maxStderrBytes)
        fail(
          new OwnedProcessError(
            'LANGUAGE_OUTPUT_LIMIT',
            'Language tool diagnostics exceeded their size limit.',
          ),
        );
      else stderr.push(chunk);
    });
    child.once('close', finish);
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) abort();
    else {
      try {
        child.stdin.end(options.input);
      } catch {
        streamFailure();
      }
    }
  });
}
