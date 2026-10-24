import { create } from 'zustand';
import { preferencesSaved } from './ui';
import { dirty, documentSavesSettled, useWorkspace } from './workspace';
import { documentSessions } from './document-sessions';
import { aiSavesSettled, currentAISaveState } from '../features/chat/useAISettings';

const preparations = new Set<() => Promise<void>>();
export const useShutdown = create<{ pending: boolean }>(() => ({ pending: false }));

/** Each mounted persistence owner contributes an awaited close barrier. */
export function registerClosePreparation(prepare: () => Promise<void>): () => void {
  preparations.add(prepare);
  return () => {
    preparations.delete(prepare);
  };
}

/** Flush mounted owners before main retires a project token; never forces dirty files to save. */
export async function flushWorkspacePersistence(): Promise<void> {
  await Promise.all([
    preferencesSaved(),
    documentSavesSettled(),
    aiSavesSettled(),
    ...[...preparations].map((prepare) => prepare()),
  ]);
  if (currentAISaveState() === 'error') throw new Error('AI settings could not be saved.');
}

export function installShutdown(): () => void {
  let active = true;
  let preparing = false;
  let generation = 0;
  const block = (event: Event) => {
    if (!useShutdown.getState().pending) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const events = ['keydown', 'beforeinput', 'pointerdown', 'click', 'submit'] as const;
  events.forEach((event) => document.addEventListener(event, block, true));
  const cancel = window.textra.onCloseCancelled(() => {
    generation++;
    preparing = false;
    documentSessions.locked = false;
    useShutdown.setState({ pending: false });
  });
  const unsubscribe = window.textra.onBeforeClose((requestId) => {
    if (preparing) return;
    const attempt = ++generation;
    preparing = true;
    documentSessions.locked = true;
    useShutdown.setState({ pending: true });
    void (async () => {
      let ready = true;
      try {
        await flushWorkspacePersistence();
        if (!active || attempt !== generation) return;
        const result = await window.textra.setDirty(useWorkspace.getState().documents.some(dirty));
        if (!result.ok) throw new Error(result.error);
      } catch {
        ready = false;
      }
      if (active && attempt === generation)
        await window.textra.acknowledgeBeforeClose({ requestId, ready });
    })()
      .catch(() => {
        if (attempt !== generation) return;
        documentSessions.locked = false;
        useShutdown.setState({ pending: false });
      })
      .finally(() => {
        if (attempt === generation) preparing = false;
      });
  });
  return () => {
    active = false;
    unsubscribe();
    cancel();
    events.forEach((event) => document.removeEventListener(event, block, true));
    documentSessions.locked = false;
    useShutdown.setState({ pending: false });
  };
}
