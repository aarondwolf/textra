import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppInfo, Preferences, Result, TextraAPI } from '../shared/api';

const api: TextraAPI = {
  getAISettings: () => ipcRenderer.invoke('textra:ai:settings'),
  saveAIKey: (request) => ipcRenderer.invoke('textra:ai:key', request),
  deleteAIKey: () => ipcRenderer.invoke('textra:ai:delete'),
  setAIAutoSend: (request) => ipcRenderer.invoke('textra:ai:auto-send', request),
  sendAIMessage: (request) => ipcRenderer.invoke('textra:ai:send', request),
  syncAIAgentDocument: (document) => ipcRenderer.invoke('textra:agent:document', document),
  runAIAgent: (request) => ipcRenderer.invoke('textra:agent:run', request),
  acceptAIAgentProposal: (request) => ipcRenderer.invoke('textra:agent:accept', request),
  rejectAIAgentProposal: (id) => ipcRenderer.invoke('textra:agent:reject', id),
  reviewAIAgentProposal: (request) => ipcRenderer.invoke('textra:agent:review', request),
  openAIRateLimits: () => ipcRenderer.invoke('textra:ai:rate-limits'),
  listAIChats: (projectId) => ipcRenderer.invoke('textra:ai:chats:list', projectId),
  saveAIChat: (request) => ipcRenderer.invoke('textra:ai:chats:save', request),
  deleteAIChat: (request) => ipcRenderer.invoke('textra:ai:chats:delete', request),
  onAIResponseChunk: (listener) => {
    const receive = (_event: IpcRendererEvent, value: unknown) => {
      if (
        value &&
        typeof value === 'object' &&
        'requestId' in value &&
        typeof value.requestId === 'string' &&
        /^[A-Za-z0-9-]{1,64}$/.test(value.requestId) &&
        'text' in value &&
        typeof value.text === 'string' &&
        value.text.length <= 32_000
      )
        listener({ requestId: value.requestId, text: value.text });
    };
    ipcRenderer.on('textra:ai:chunk', receive);
    return () => ipcRenderer.removeListener('textra:ai:chunk', receive);
  },
  cancelAIMessage: () => ipcRenderer.invoke('textra:ai:cancel'),
  openAIStudio: () => ipcRenderer.invoke('textra:ai:studio'),
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
  watchExternalFile: (request) => ipcRenderer.invoke('textra:file:watch-external', request),
  unwatchExternalFile: (request) => ipcRenderer.invoke('textra:file:unwatch-external', request),
  onExternalFileChange: (listener) => {
    const receive = (_event: IpcRendererEvent, value: unknown) => {
      listener(value as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on('textra:file:external-change', receive);
    return () => ipcRenderer.removeListener('textra:file:external-change', receive);
  },
  createConflictCopy: (request) => ipcRenderer.invoke('textra:file:create-conflict-copy', request),
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
  readProjectPdf: (request) => ipcRenderer.invoke('textra:pdf:read-project', request),
  syncForward: (request) => ipcRenderer.invoke('textra:sync:forward', request),
  syncInverse: (request) => ipcRenderer.invoke('textra:sync:inverse', request),
  getProjectConfig: (id) => ipcRenderer.invoke('textra:config:get', id),
  setProjectConfig: (request) => ipcRenderer.invoke('textra:config:set', request),
  cleanProjectBuildArtifacts: (projectId) =>
    ipcRenderer.invoke('textra:build:clean-artifacts', projectId),
  exportSettings: () => ipcRenderer.invoke('textra:settings:export'),
  importSettings: () => ipcRenderer.invoke('textra:settings:import'),
  openSetupLink: (target) => ipcRenderer.invoke('textra:setup:link', target),
  testDistribution: () => ipcRenderer.invoke('textra:setup:test'),
  getLanguageToolStatus: () => ipcRenderer.invoke('textra:language:status'),
  getTexlabStatus: () => ipcRenderer.invoke('textra:texlab:status'),
  checkTexlab: () => ipcRenderer.invoke('textra:texlab:check'),
  syncTexlabDocument: (request) => ipcRenderer.invoke('textra:texlab:sync', request),
  texlabRequest: (request) => ipcRenderer.invoke('textra:texlab:request', request),
  getTexlabDiagnostics: (request) => ipcRenderer.invoke('textra:texlab:diagnostics', request),
  lintLatex: (request) => ipcRenderer.invoke('textra:language:lint', request),
  formatLatex: (request) => ipcRenderer.invoke('textra:language:format', request),
  openStackExchangeSearch: (query) => ipcRenderer.invoke('textra:language:stackexchange', query),
  openTexFaqHelp: (url) => ipcRenderer.invoke('textra:help:texfaq', url),
  copyText: (text) => ipcRenderer.invoke('textra:clipboard:copy', text),
};

contextBridge.exposeInMainWorld('textra', Object.freeze(api));
