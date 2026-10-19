import { create } from 'zustand';
import { DEFAULT_PREFERENCES, type Preferences } from '../../../shared/api';

interface UIState {
  preferences: Preferences;
  hydrated: boolean;
  error: string | null;
  paletteOpen: boolean;
  recipeEditorOpen: boolean;
  panel: 'preview' | 'problems' | 'output';
  updatePreferences: (patch: Partial<Omit<Preferences, 'version'>>) => void;
  setPaletteOpen: (open: boolean) => void;
  setRecipeEditorOpen: (open: boolean) => void;
  setPanel: (panel: 'preview' | 'problems' | 'output') => void;
}

let pending: Preferences | null = null;
let saving = false;

async function savePreferences(): Promise<void> {
  if (saving) return;
  saving = true;
  try {
    while (pending) {
      const value = pending;
      pending = null;
      try {
        const result = await window.textra.setPreferences(value);
        useUI.setState({ error: result.ok ? null : result.error });
      } catch {
        useUI.setState({ error: 'Your layout could not be saved. Changes apply to this session.' });
      }
    }
  } finally {
    saving = false;
  }
}

export const useUI = create<UIState>((set, get) => ({
  preferences: { ...DEFAULT_PREFERENCES },
  hydrated: false,
  error: null,
  paletteOpen: false,
  recipeEditorOpen: false,
  panel: 'preview',
  updatePreferences: (patch) => {
    if (!get().hydrated) return;
    const preferences = { ...get().preferences, ...patch };
    set({ preferences });
    pending = preferences;
    void savePreferences();
  },
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setRecipeEditorOpen: (recipeEditorOpen) => set({ recipeEditorOpen }),
  setPanel: (panel) => set({ panel }),
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
