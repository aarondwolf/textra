import { create } from 'zustand';
import { useEffect } from 'react';
import type { AISettings } from '../../../shared/api';
import { supportsAIRole, type AIModelRef, type AIRole } from '../../../shared/ai';

type WorkspaceSelections = Partial<Record<AIRole, AIModelRef | null>>;
export const useAIRoleSelections = create<{
  workspaces: Record<string, WorkspaceSelections>;
  select: (workspaceId: string | null | undefined, role: AIRole, model: AIModelRef | null) => void;
  reconcile: (settings: AISettings) => void;
}>((set) => ({
  workspaces: {},
  reconcile: (settings) =>
    set((state) => {
      let changed = false;
      const workspaces = Object.fromEntries(
        Object.entries(state.workspaces).map(([id, selections]) => {
          const next = { ...selections };
          for (const [key, ref] of Object.entries(selections)) {
            const role = key as AIRole;
            const provider = settings.providers.find(
              (item) => item.id === ref?.provider && item.configured,
            );
            if (
              ref &&
              !provider?.models.some(
                (model) => model.id === ref.model && supportsAIRole(model, role),
              )
            ) {
              next[role] = null;
              changed = true;
            }
          }
          return [id, next];
        }),
      );
      return changed ? { workspaces } : state;
    }),
  select: (workspaceId, role, model) =>
    set((state) => {
      const key = workspaceId ?? '';
      return {
        workspaces: { ...state.workspaces, [key]: { ...state.workspaces[key], [role]: model } },
      };
    }),
}));

function resolve(
  settings: AISettings | null,
  role: AIRole,
  override: AIModelRef | null | undefined,
) {
  const model = override === undefined ? (settings?.roleDefaults[role] ?? null) : override;
  const provider = settings?.providers.find((item) => item.id === model?.provider);
  const info = provider?.configured
    ? provider.models.find((item) => item.id === model?.model)
    : null;
  const available = Boolean(info && supportsAIRole(info, role));
  return { model: available ? model : null, available };
}

/** Session-only workspace choices. Removed models clear rather than silently revive. */
export function getAIRoleSelection(
  workspaceId: string | null | undefined,
  role: AIRole,
  settings: AISettings | null,
) {
  if (settings) useAIRoleSelections.getState().reconcile(settings);
  return resolve(
    settings,
    role,
    useAIRoleSelections.getState().workspaces[workspaceId ?? '']?.[role],
  );
}

export function useAIRoleSelection(
  workspaceId: string | null | undefined,
  role: AIRole,
  settings: AISettings | null,
) {
  const override = useAIRoleSelections((state) => state.workspaces[workspaceId ?? '']?.[role]);
  const select = useAIRoleSelections((state) => state.select);
  const reconcile = useAIRoleSelections((state) => state.reconcile);
  useEffect(() => {
    if (settings) reconcile(settings);
  }, [settings, reconcile]);
  return {
    ...resolve(settings, role, override),
    selectModel: (model: AIModelRef | null) => select(workspaceId, role, model),
  };
}
