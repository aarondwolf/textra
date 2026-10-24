import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentSessions } from '../../src/renderer/src/state/document-sessions';
import {
  installShutdown,
  flushWorkspacePersistence,
  registerClosePreparation,
  useShutdown,
} from '../../src/renderer/src/state/shutdown';

const workspace = vi.hoisted(() => ({
  documents: [] as { content: string; savedContent: string }[],
}));

vi.mock('../../src/renderer/src/state/ui', () => ({
  preferencesSaved: vi.fn(async () => undefined),
}));
vi.mock('../../src/renderer/src/state/workspace', () => ({
  documentSavesSettled: vi.fn(async () => undefined),
  useWorkspace: { getState: () => workspace },
  dirty: (document: { content: string; savedContent: string }) =>
    document.content !== document.savedContent,
}));
vi.mock('../../src/renderer/src/features/chat/useAISettings', () => ({
  aiSavesSettled: vi.fn(async () => undefined),
  currentAISaveState: () => 'saved',
}));

let beforeClose!: (requestId: string) => void;
let cancelled!: () => void;
const acknowledge = vi.fn(async () => ({ ok: true, value: undefined }));
const setDirty = vi.fn<(dirty: boolean) => Promise<{ ok: boolean; error?: string }>>(async () => ({
  ok: true,
}));
const unsubscribeClose = vi.fn();
const unsubscribeCancel = vi.fn();
const cleanups: (() => void)[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  workspace.documents = [];
  vi.stubGlobal('document', new EventTarget());
  vi.stubGlobal('window', {
    textra: {
      onBeforeClose: (listener: typeof beforeClose) => {
        beforeClose = listener;
        return unsubscribeClose;
      },
      onCloseCancelled: (listener: typeof cancelled) => {
        cancelled = listener;
        return unsubscribeCancel;
      },
      acknowledgeBeforeClose: acknowledge,
      setDirty,
    },
  });
  cleanups.push(installShutdown());
});
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

describe('renderer close barrier', () => {
  it('awaits persistence and holds input lock until native close is cancelled', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    cleanups.push(registerClosePreparation(() => pending));
    beforeClose('close-one');
    expect(useShutdown.getState().pending).toBe(true);
    expect(documentSessions.locked).toBe(true);
    const typing = new Event('beforeinput', { cancelable: true });
    document.dispatchEvent(typing);
    expect(typing.defaultPrevented).toBe(true);
    expect(acknowledge).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() =>
      expect(acknowledge).toHaveBeenCalledWith({ requestId: 'close-one', ready: true }),
    );
    expect(documentSessions.locked).toBe(true);
    cancelled();
    expect(documentSessions.locked).toBe(false);
    expect(useShutdown.getState().pending).toBe(false);
  });

  it('reports persistence failure without approving shutdown', async () => {
    cleanups.push(
      registerClosePreparation(async () => {
        throw new Error('disk full');
      }),
    );
    beforeClose('failed-close');
    await vi.waitFor(() =>
      expect(acknowledge).toHaveBeenCalledWith({ requestId: 'failed-close', ready: false }),
    );
  });

  it('awaits the current authoritative dirty bit before acknowledging a fast edit and close', async () => {
    workspace.documents = [{ content: 'new unsaved writing', savedContent: 'disk text' }];
    let finish!: (result: { ok: boolean }) => void;
    setDirty.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    beforeClose('dirty-close');
    await vi.waitFor(() => expect(setDirty).toHaveBeenCalledWith(true));
    expect(acknowledge).not.toHaveBeenCalled();
    finish({ ok: true });
    await vi.waitFor(() =>
      expect(acknowledge).toHaveBeenCalledWith({ requestId: 'dirty-close', ready: true }),
    );
  });

  it('fails closed when main cannot synchronize the dirty bit', async () => {
    setDirty.mockResolvedValueOnce({ ok: false, error: 'unavailable' });
    beforeClose('dirty-error');
    await vi.waitFor(() =>
      expect(acknowledge).toHaveBeenCalledWith({ requestId: 'dirty-error', ready: false }),
    );
  });

  it('awaits mounted workspace persistence before allowing its token to retire without saving dirty files', async () => {
    let release!: () => void;
    cleanups.push(
      registerClosePreparation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    );
    workspace.documents = [{ content: 'keep unsaved', savedContent: 'disk' }];
    let settled = false;
    const flushing = flushWorkspacePersistence().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await flushing;
    expect(workspace.documents[0].content).toBe('keep unsaved');
    expect(setDirty).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('ignores a late preparation result after native cancellation', async () => {
    let release!: () => void;
    cleanups.push(
      registerClosePreparation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
    );
    beforeClose('cancelled-close');
    cancelled();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('unsubscribes native listeners and releases input ownership on unmount', () => {
    beforeClose('unmounted');
    cleanups.shift()!();
    expect(unsubscribeClose).toHaveBeenCalledOnce();
    expect(unsubscribeCancel).toHaveBeenCalledOnce();
    const event = new Event('beforeinput', { cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(documentSessions.locked).toBe(false);
  });
});
