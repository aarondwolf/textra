import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TexlabManager } from '../../src/main/services/texlab-manager';
import type { ProjectService } from '../../src/main/services/projects';

const mock = vi.hoisted(() => ({
  service: {
    status: { running: false },
    start: vi.fn(),
    stop: vi.fn(),
    openDocument: vi.fn(),
    closeDocument: vi.fn(),
  },
}));
vi.mock('../../src/main/services/texlab', async (original) => ({
  ...(await original<typeof import('../../src/main/services/texlab')>()),
  TexlabService: class {
    constructor() {
      return mock.service;
    }
  },
}));

describe('TexLab workspace stop reservation', () => {
  let manager: TexlabManager;
  let resolvePath: ReturnType<typeof vi.fn>;
  const request = { projectId: 'project', path: 'main.tex', content: 'source', version: 1 };
  beforeEach(() => {
    mock.service.status.running = false;
    mock.service.start.mockReset().mockImplementation(async () => {
      mock.service.status.running = true;
    });
    mock.service.stop.mockReset().mockImplementation(async () => {
      mock.service.status.running = false;
    });
    mock.service.openDocument.mockReset().mockResolvedValue(undefined);
    resolvePath = vi.fn().mockResolvedValue(process.execPath);
    manager = new TexlabManager(
      { getRoot: () => process.cwd(), resolvePath } as unknown as ProjectService,
      process.cwd(),
      async () => true,
    );
    vi.spyOn(
      manager as unknown as { resolveInstallation(): Promise<unknown> },
      'resolveInstallation',
    ).mockResolvedValue({ installation: 'managed', path: process.execPath });
  });

  it('reserves stop at full queue capacity, invalidates queued work, and rejects arrivals during drain', async () => {
    let release!: () => void;
    resolvePath.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return process.execPath;
    });
    const work = Array.from({ length: 64 }, () => manager.sync(request));
    const results = Promise.allSettled(work);
    await vi.waitFor(() => expect(resolvePath).toHaveBeenCalledOnce());
    await expect(manager.sync(request)).rejects.toMatchObject({ code: 'TEXLAB_BUSY' });
    const stopping = manager.stop();
    await expect(manager.sync(request)).rejects.toMatchObject({ code: 'TEXLAB_BUSY' });
    release();
    await stopping;
    expect((await results).every((result) => result.status === 'rejected')).toBe(true);
    expect(mock.service.start).not.toHaveBeenCalled();
    expect(mock.service.openDocument).not.toHaveBeenCalled();
    await expect(manager.sync(request)).resolves.toBe(process.execPath);
    expect(mock.service.start).toHaveBeenCalledOnce();
    await manager.stop();
  });

  it('interrupts initialization already in flight and performs final cleanup after it settles', async () => {
    let release!: () => void;
    mock.service.start.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      mock.service.status.running = true;
    });
    const pending = manager.sync(request);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TEXLAB_NOT_STARTED' });
    await vi.waitFor(() => expect(mock.service.start).toHaveBeenCalledOnce());
    const stopping = manager.stop();
    await vi.waitFor(() => expect(mock.service.stop).toHaveBeenCalledOnce());
    release();
    await rejected;
    await stopping;
    expect(mock.service.status.running).toBe(false);
    expect(mock.service.stop).toHaveBeenCalledTimes(2);
    expect(mock.service.openDocument).not.toHaveBeenCalled();
  });
});
