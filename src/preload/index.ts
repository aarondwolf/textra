import { contextBridge, ipcRenderer } from 'electron';
import type { AppInfo, Preferences, Result, TextraAPI } from '../shared/api';

const api: TextraAPI = {
  getAppInfo: () => ipcRenderer.invoke('textra:app-info') as Promise<Result<AppInfo>>,
  getPreferences: () =>
    ipcRenderer.invoke('textra:preferences:get') as Promise<Result<Preferences>>,
  setPreferences: (value) =>
    ipcRenderer.invoke('textra:preferences:set', value) as Promise<Result<Preferences>>,
  chooseProject: () => ipcRenderer.invoke('textra:project:choose'),
  refreshProject: (projectId) => ipcRenderer.invoke('textra:project:refresh', projectId),
  readFile: (request) => ipcRenderer.invoke('textra:file:read', request),
  saveFile: (request) => ipcRenderer.invoke('textra:file:save', request),
  createEntry: (request) => ipcRenderer.invoke('textra:file:create', request),
  renameEntry: (request) => ipcRenderer.invoke('textra:file:rename', request),
  deleteEntry: (request) => ipcRenderer.invoke('textra:file:delete', request),
  getFileRevisions: (request) => ipcRenderer.invoke('textra:file:revisions', request),
  revealEntry: (request) => ipcRenderer.invoke('textra:file:reveal', request),
  copyEntryPath: (request) => ipcRenderer.invoke('textra:file:copy-path', request),
  openInCode: (request) => ipcRenderer.invoke('textra:file:code', request),
  getRecentProjects: () => ipcRenderer.invoke('textra:recent:get'),
  openRecentProject: (id) => ipcRenderer.invoke('textra:recent:open', id),
  setProjectPinned: (request) => ipcRenderer.invoke('textra:recent:pin', request),
  setDirty: (dirty) => ipcRenderer.invoke('textra:dirty', dirty),
  detectTools: () => ipcRenderer.invoke('textra:tools'),
  chooseToolPath: (name) => ipcRenderer.invoke('textra:tools:choose', name),
  compile: (request) => ipcRenderer.invoke('textra:build:compile', request),
  cancelBuild: () => ipcRenderer.invoke('textra:build:cancel'),
  getBuildState: () => ipcRenderer.invoke('textra:build:state'),
  readPdf: (request) => ipcRenderer.invoke('textra:pdf:read', request),
  syncForward: (request) => ipcRenderer.invoke('textra:sync:forward', request),
  syncInverse: (request) => ipcRenderer.invoke('textra:sync:inverse', request),
  getProjectConfig: (id) => ipcRenderer.invoke('textra:config:get', id),
  setProjectConfig: (request) => ipcRenderer.invoke('textra:config:set', request),
  exportSettings: () => ipcRenderer.invoke('textra:settings:export'),
  importSettings: () => ipcRenderer.invoke('textra:settings:import'),
  openSetupLink: (target) => ipcRenderer.invoke('textra:setup:link', target),
  testDistribution: () => ipcRenderer.invoke('textra:setup:test'),
  getLanguageToolStatus: () => ipcRenderer.invoke('textra:language:status'),
  lintLatex: (request) => ipcRenderer.invoke('textra:language:lint', request),
  formatLatex: (request) => ipcRenderer.invoke('textra:language:format', request),
  openStackExchangeSearch: (query) => ipcRenderer.invoke('textra:language:stackexchange', query),
  copyText: (text) => ipcRenderer.invoke('textra:clipboard:copy', text),
};

contextBridge.exposeInMainWorld('textra', Object.freeze(api));
