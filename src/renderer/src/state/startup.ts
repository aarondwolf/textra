import { create } from 'zustand';

export const useStartup = create<{
  editorReady: boolean;
  restoration: 'idle' | 'restoring' | 'settled';
}>(() => ({ editorReady: false, restoration: 'idle' }));
