import { create } from 'zustand';
import { DEFAULT_PREFERENCES, type Preferences } from '../../../shared/api';

interface UIState {
  preferences: Preferences;
  hydrated: boolean;
  error: string | null;
  /** Autosave progress for preference changes, shown in the Settings footer. */
  saveState: 'idle' | 'saving' | 'saved' | 'error';
  paletteOpen: boolean;
  recipeEditorOpen: boolean;
  panel: 'preview' | 'problems' | 'output';
  updatePreferences: (patch: Partial<Omit<Preferences, 'version'>>) => void;
  setPaletteOpen: (open: boolean) => void;
  setRecipeEditorOpen: (open: boolean) => void;
  setPanel: (panel: 'preview' | 'problems' | 'output') => void;
  /** Session-only: one pane fills the whole workspace and the other is hidden. */
  expandedPane: 'editor' | 'preview' | null;
  setExpandedPane: (pane: 'editor' | 'preview' | null) => void;
}

let pending: Preferences | null = null;
let current: Promise<void> | null = null;

/** Resolves once every queued preference change has been written (or has failed). */
export function preferencesSaved(): Promise<void> {
  return current ?? Promise.resolve();
}

function savePreferences(): Promise<void> {
  current ??= persistPending().finally(() => {
    current = null;
  });
  return current;
}

async function persistPending(): Promise<void> {
  let failed = false;
  while (pending) {
    const value = pending;
    pending = null;
    try {
      const result = await window.textra.setPreferences(value);
      failed = !result.ok;
      useUI.setState({ error: result.ok ? null : result.error });
    } catch {
      failed = true;
      useUI.setState({ error: 'Your layout could not be saved. Changes apply to this session.' });
    }
  }
  useUI.setState({ saveState: failed ? 'error' : 'saved' });
}

export const useUI = create<UIState>((set, get) => ({
  preferences: { ...DEFAULT_PREFERENCES },
  hydrated: false,
  error: null,
  saveState: 'idle',
  paletteOpen: false,
  recipeEditorOpen: false,
  panel: 'preview',
  expandedPane: null,
  updatePreferences: (patch) => {
    if (!get().hydrated) return;
    const preferences = { ...get().preferences, ...patch };
    set({ preferences, saveState: 'saving' });
    pending = preferences;
    void savePreferences();
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setRecipeEditorOpen: (recipeEditorOpen) => set({ recipeEditorOpen }),
  setPanel: (panel) => set({ panel }),
  setExpandedPane: (expandedPane) => set({ expandedPane }),
}));

let hydration: Promise<void> | undefined;
export function hydratePreferences(): Promise<void> {
  hydration ??= (async () => {
    try {
      const result = await window.textra.getPreferences();
      if (result.ok)
        useUI.setState({
          preferences: { ...DEFAULT_PREFERENCES, ...result.value },
          hydrated: true,
        });
      else useUI.setState({ error: result.error, hydrated: true });
    } catch {
      useUI.setState({
        error: 'Saved preferences are unavailable. Using the default layout.',
        hydrated: true,
      });
    }
  })();
  return hydration;
}
