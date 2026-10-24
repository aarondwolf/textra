import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageService } from '../../src/main/services/language';
import { DEFAULT_PREFERENCES } from '../../src/shared/api';
import type { ProjectService } from '../../src/main/services/projects';

const mock = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../src/main/services/owned-process', async (original) => ({
  ...(await original<typeof import('../../src/main/services/owned-process')>()),
  runOwnedProcess: mock.run,
}));
vi.mock('../../src/main/services/tool-paths', () => ({ getToolPath: () => process.execPath }));
vi.mock('../../src/main/services/recipe-plan', () => ({
  recipeDirectory: async (_root: string, directory: string) => directory,
}));

describe('language task lifetime and workspace concurrency', () => {
  let service: LanguageService;
  const ref = { projectId: 'project', path: 'main.tex' };
  beforeEach(() => {
    service = new LanguageService(
      {
        getRoot: () => process.cwd(),
        resolvePath: async () => process.execPath,
      } as unknown as ProjectService,
      async () => DEFAULT_PREFERENCES,
    );
    mock.run.mockReset();
    mock.run.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
  });
  afterEach(async () => {
    await service.stop();
  });

  it('supersedes lint and waits for its process before launching its replacement', async () => {
    const first = service.lint({ ...ref, requestId: 'first' });
    const rejected = expect(first).rejects.toMatchObject({ code: 'LANGUAGE_CANCELLED' });
    await vi.waitFor(() => expect(mock.run).toHaveBeenCalledTimes(1));
    const second = service.lint({ ...ref, requestId: 'second' });
    const stopped = expect(second).rejects.toMatchObject({ code: 'LANGUAGE_CANCELLED' });
    await rejected;
    await vi.waitFor(() => expect(mock.run).toHaveBeenCalledTimes(2));
    service.cancel({ requestId: 'second' });
    await stopped;
  });

  it('rejects duplicate formatting and cancels the actual running formatter', async () => {
    const first = service.format({ ...ref, content: 'source', requestId: 'format' });
    const rejected = expect(first).rejects.toMatchObject({ code: 'LANGUAGE_CANCELLED' });
    await vi.waitFor(() => expect(mock.run).toHaveBeenCalledOnce());
    await expect(service.format({ ...ref, content: 'next' })).rejects.toMatchObject({
      code: 'LANGUAGE_BUSY',
    });
    service.cancel({ requestId: 'format' });
    await rejected;
    expect(mock.run).toHaveBeenCalledOnce();
  });

  it('drains both slots on stop and permits a later workspace session', async () => {
    const lint = service.lint({ ...ref, requestId: 'lint' });
    const format = service.format({ ...ref, content: 'source', requestId: 'format' });
    const results = Promise.allSettled([lint, format]);
    await vi.waitFor(() => expect(mock.run).toHaveBeenCalledTimes(2));
    await service.stop();
    expect((await results).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    mock.run.mockResolvedValue({ stdout: 'formatted', stderr: '', code: 0 });
    await expect(service.format({ ...ref, content: 'source' })).resolves.toEqual({
      content: 'formatted',
      formatter: 'latexindent',
    });
  });

  it('remembers cancellation that arrives before request initialization', async () => {
    service.cancel({ requestId: 'cancel-before-start' });
    await expect(service.lint({ ...ref, requestId: 'cancel-before-start' })).rejects.toMatchObject({
      code: 'LANGUAGE_CANCELLED',
    });
    expect(mock.run).not.toHaveBeenCalled();
  });

  it('does not launch a delayed tool lookup after its task has been stopped', async () => {
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => {
      release = resolve;
    });
    const projects = {
      getRoot: () => process.cwd(),
      resolvePath: async () => {
        await deferred;
        return process.execPath;
      },
    };
    service = new LanguageService(
      projects as unknown as ProjectService,
      async () => DEFAULT_PREFERENCES,
    );
    const lint = service.lint(ref);
    const rejected = expect(lint).rejects.toMatchObject({ code: 'LANGUAGE_CANCELLED' });
    await Promise.resolve();
    const stop = service.stop();
    release();
    await stop;
    await rejected;
    expect(mock.run).not.toHaveBeenCalled();
  });
});
