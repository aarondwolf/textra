import { create } from 'zustand';

/** Session-only backdrop count; window controls remain usable above modal backdrops. */
export const useWindowChrome = create<{
  modalCount: number;
  changeModalCount: (delta: 1 | -1) => void;
}>((set) => ({
  modalCount: 0,
  changeModalCount: (delta) =>
    set((state) => ({ modalCount: Math.max(0, state.modalCount + delta) })),
}));
