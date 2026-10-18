import { contextBridge, ipcRenderer } from 'electron';
import type { AppInfo, Preferences, Result, TextraAPI } from '../shared/api';

const api: TextraAPI = {
  getAppInfo: () => ipcRenderer.invoke('textra:app-info') as Promise<Result<AppInfo>>,
  getPreferences: () =>
    ipcRenderer.invoke('textra:preferences:get') as Promise<Result<Preferences>>,
  setPreferences: (value) =>
    ipcRenderer.invoke('textra:preferences:set', value) as Promise<Result<Preferences>>,
};

contextBridge.exposeInMainWorld('textra', Object.freeze(api));
