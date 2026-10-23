import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';
import type { AISettings, Result } from '../../../../shared/api';
import type { SaveState } from '../save-status/SaveFooter';
import {
  AI_PROVIDERS,
  sameModel,
  supportsAIRole,
  isModelVisible,
  type AIRole,
  type AIModelInfo,
  type AIModelRef,
  type AIProviderId,
} from '../../../../shared/ai';

export const AI_SETTINGS_CHANGED = 'textra-ai-settings-changed';

const useCachedSettings = create<{ settings: AISettings | null; error: string }>(() => ({
  settings: null,
  error: '',
}));
let loadingSettings: Promise<void> | undefined;
let settingsRevision = 0;

/** One offline read shared by the editor, chat and settings; writes supersede stale reads. */
export function loadAISettings(force = false): Promise<void> {
  if (!force && useCachedSettings.getState().settings) return Promise.resolve();
  loadingSettings ??= (async () => {
    const revision = settingsRevision;
    try {
      const result = await window.textra.getAISettings();
      if (revision !== settingsRevision) return;
      if (result.ok) useCachedSettings.setState({ settings: result.value, error: '' });
      else useCachedSettings.setState({ error: result.error });
    } catch {
      if (revision === settingsRevision)
        useCachedSettings.setState({ error: 'Could not load AI settings. Please try again.' });
    }
  })().finally(() => {
    loadingSettings = undefined;
  });
  return loadingSettings;
}

/** Broadcasts saved settings so every open chat and dialog stays in sync. */
export function publishAISettings(settings: AISettings): void {
  settingsRevision++;
  useCachedSettings.setState({ settings, error: '' });
  window.dispatchEvent(new CustomEvent<AISettings>(AI_SETTINGS_CHANGED, { detail: settings }));
}

export function useAISettings(active = true) {
  const { settings, error } = useCachedSettings();
  const refresh = useCallback(() => loadAISettings(true), []);
  useEffect(() => {
    if (active) void loadAISettings();
  }, [active, refresh]);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<AISettings | undefined>).detail;
      if (detail) {
        settingsRevision++;
        useCachedSettings.setState({ settings: detail, error: '' });
      } else void refresh();
    };
    window.addEventListener(AI_SETTINGS_CHANGED, listener);
    return () => window.removeEventListener(AI_SETTINGS_CHANGED, listener);
  }, [refresh]);
  return { settings, error, refresh };
}

export interface ModelGroup {
  provider: AIProviderId;
  label: string;
  defaultModel: string | null;
  models: AIModelInfo[];
}

/** Configured providers with models, in provider order. */
export function modelGroups(
  settings: AISettings | null,
  only?: AIProviderId,
  role?: AIRole,
): ModelGroup[] {
  if (!settings) return [];
  return settings.providers
    .filter(
      (provider) =>
        provider.configured &&
        provider.enabled !== false &&
        provider.id !== 'codestral' &&
        provider.models.length,
    )
    .filter((provider) => !only || provider.id === only)
    .map((provider) => ({
      provider: provider.id,
      label: provider.displayName || AI_PROVIDERS[provider.id].label,
      defaultModel: provider.defaultModel,
      models: provider.models.filter(
        (model) =>
          (!role || supportsAIRole(model, role)) &&
          isModelVisible(
            provider.filters?.[role === 'completion' ? 'completion' : 'chat'],
            model.id,
          ),
      ),
    }))
    .filter((group) => group.models.length);
}

export function modelUnavailableReason(
  settings: AISettings | null,
  ref: AIModelRef | null,
  role?: AIRole,
): string | null {
  if (!ref || !settings) return null;
  const provider = settings.providers.find((item) => item.id === ref.provider);
  if (!provider?.configured) return 'This connection has been removed.';
  if (provider.id === 'codestral') return 'Use the Mistral connection for this model.';
  if (provider.enabled === false) return 'This connection is silenced.';
  const model = provider.models.find((item) => item.id === ref.model);
  if (!model) return 'This model is missing from the connection’s catalog.';
  if (role && !supportsAIRole(model, role)) return 'This model does not support this role.';
  if (!isModelVisible(provider.filters?.[role === 'completion' ? 'completion' : 'chat'], model.id))
    return 'This model is hidden for this role.';
  return null;
}

export function findModel(settings: AISettings | null, ref: AIModelRef | null, role?: AIRole) {
  if (!settings || !ref) return null;
  if (modelUnavailableReason(settings, ref, role)) return null;
  const provider = settings.providers.find((item) => item.id === ref.provider);
  return provider?.models.find((model) => model.id === ref.model) ?? null;
}

export function isDefaultModel(
  settings: AISettings | null,
  ref: AIModelRef,
  role: AIRole = 'assistant',
) {
  return sameModel(settings?.roleDefaults[role], ref);
}

const AI_SAVE_STATE = 'textra-ai-save-state';
let inflight = 0;
let latestSaveState: SaveState = 'idle';
let settledWaiters: Array<() => void> = [];
function emitSave(state: SaveState): void {
  latestSaveState = state;
  window.dispatchEvent(new CustomEvent<SaveState>(AI_SAVE_STATE, { detail: state }));
}

export function currentAISaveState(): SaveState {
  return latestSaveState;
}

/** Wraps a settings write so the dialog footer can show Saving… and Saved. */
export async function trackAISave<T>(operation: Promise<Result<T>>): Promise<Result<T>> {
  inflight++;
  emitSave('saving');
  let state: SaveState = 'error';
  try {
    const result = await operation;
    // null means the person cancelled a confirmation; nothing changed.
    state = !result.ok
      ? result.code === 'AI_CANCELLED'
        ? 'idle'
        : 'error'
      : result.value === null
        ? 'idle'
        : 'saved';
    return result;
  } finally {
    inflight--;
    if (!inflight) {
      emitSave(state);
      const waiters = settledWaiters;
      settledWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }
}

/** Resolves once no AI settings write is in flight. */
export function aiSavesSettled(): Promise<void> {
  return inflight ? new Promise((resolve) => settledWaiters.push(resolve)) : Promise.resolve();
}

export function useAISaveState(): SaveState {
  const [state, setState] = useState<SaveState>(latestSaveState);
  useEffect(() => {
    const listener = (event: Event) => setState((event as CustomEvent<SaveState>).detail);
    window.addEventListener(AI_SAVE_STATE, listener);
    return () => window.removeEventListener(AI_SAVE_STATE, listener);
  }, []);
  return state;
}
