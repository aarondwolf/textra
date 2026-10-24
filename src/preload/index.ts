import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppInfo, Preferences, Result, TextraAPI } from '../shared/api';
import { AI_ASSISTANT_STATUS_LIMIT, type AIAssistantEvent } from '../shared/ai';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Validates main's display-only assistant events before they reach the renderer. */
function assistantEvent(value: unknown): AIAssistantEvent | null {
  if (
    !isRecord(value) ||
    typeof value.requestId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.requestId)
  )
    return null;
  if (value.type === 'text' && typeof value.text === 'string' && value.text.length <= 32_000)
    return { requestId: value.requestId, type: 'text', text: value.text };
  if (value.type === 'reasoning' && typeof value.text === 'string' && value.text.length <= 32_000)
    return { requestId: value.requestId, type: 'reasoning', text: value.text };
  if (
    value.type === 'status' &&
    typeof value.message === 'string' &&
    value.message.length <= AI_ASSISTANT_STATUS_LIMIT
  )
    return { requestId: value.requestId, type: 'status', message: value.message };
  return null;
}

const api: TextraAPI = {
  getAISettings: () => ipcRenderer.invoke('textra:ai:settings'),
  configureAIProvider: (request) => ipcRenderer.invoke('textra:ai:provider:configure', request),
  requestAIInlineEdit: (request) => ipcRenderer.invoke('textra:ai:inline-edit:request', request),
  cancelAIInlineEdit: (request) => ipcRenderer.invoke('textra:ai:inline-edit:cancel', request),
  saveAIProvider: (request) => ipcRenderer.invoke('textra:ai:provider:save', request),
  removeAIProvider: (request) => ipcRenderer.invoke('textra:ai:provider:remove', request),
  refreshAIModels: (request) => ipcRenderer.invoke('textra:ai:models:refresh', request),
  setAIProviderDefault: (request) => ipcRenderer.invoke('textra:ai:provider:default', request),
  setAIRoleDefault: (request) => ipcRenderer.invoke('textra:ai:role-default', request),
  setAICompletionSettings: (request) =>
    ipcRenderer.invoke('textra:ai:completion:settings', request),
  requestAICompletion: (request) => ipcRenderer.invoke('textra:ai:completion:request', request),
  cancelAICompletion: (request) => ipcRenderer.invoke('textra:ai:completion:cancel', request),
  setAIAutoSend: (request) => ipcRenderer.invoke('textra:ai:auto-send', request),
  getOllamaStatus: () => ipcRenderer.invoke('textra:ai:ollama:status'),
  startOllama: () => ipcRenderer.invoke('textra:ai:ollama:start'),
  syncAIAgentDocument: (document) => ipcRenderer.invoke('textra:agent:document', document),
  runAIAssistant: (request) => ipcRenderer.invoke('textra:ai:assistant:run', request),
  cancelAIAssistant: (request) => ipcRenderer.invoke('textra:ai:assistant:cancel', request),
  acceptAIAgentProposal: (request) => ipcRenderer.invoke('textra:agent:accept', request),
  rejectAIAgentProposal: (id) => ipcRenderer.invoke('textra:agent:reject', id),
  reviewAIAgentProposal: (request) => ipcRenderer.invoke('textra:agent:review', request),
  openAIProviderLink: (request) => ipcRenderer.invoke('textra:ai:link', request),
  listAIChats: (projectId) => ipcRenderer.invoke('textra:ai:chats:list', projectId),
  saveAIChat: (request) => ipcRenderer.invoke('textra:ai:chats:save', request),
  deleteAIChat: (request) => ipcRenderer.invoke('textra:ai:chats:delete', request),
  onAIAssistantEvent: (listener) => {
    const receive = (_event: IpcRendererEvent, value: unknown) => {
      const event = assistantEvent(value);
      if (event) listener(event);
    };
    ipcRenderer.on('textra:ai:assistant:event', receive);
    return () => ipcRenderer.removeListener('textra:ai:assistant:event', receive);
  },
  onAIInlineEditChunk: (listener) => {
    const receive = (_event: IpcRendererEvent, value: unknown) => {
      if (
        isRecord(value) &&
        typeof value.requestId === 'string' &&
        /^[A-Za-z0-9-]{1,64}$/.test(value.requestId) &&
        typeof value.text === 'string' &&
        value.text.length <= 32_000
      )
        listener({ requestId: value.requestId, text: value.text });
    };
    ipcRenderer.on('textra:ai:inline-edit:chunk', receive);
    return () => ipcRenderer.removeListener('textra:ai:inline-edit:chunk', receive);
  },
  getAppInfo: () => ipcRenderer.invoke('textra:app-info') as Promise<Result<AppInfo>>,
  getPreferences: () =>
    ipcRenderer.invoke('textra:preferences:get') as Promise<Result<Preferences>>,
  setPreferences: (value) =>
    ipcRenderer.invoke('textra:preferences:set', value) as Promise<Result<Preferences>>,
  chooseProject: () => ipcRenderer.invoke('textra:project:choose'),
  refreshProject: (projectId) => ipcRenderer.invoke('textra:project:refresh', projectId),
  prepareProject: (projectId) => ipcRenderer.invoke('textra:project:prepare', projectId),
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
  restoreLastPdf: (projectId) => ipcRenderer.invoke('textra:pdf:restore', projectId),
  prepareAI: () => ipcRenderer.invoke('textra:ai:prepare'),
  readProjectPdf: (request) => ipcRenderer.invoke('textra:pdf:read-project', request),
  syncForward: (request) => ipcRenderer.invoke('textra:sync:forward', request),
  syncInverse: (request) => ipcRenderer.invoke('textra:sync:inverse', request),
  getProjectConfig: (id) => ipcRenderer.invoke('textra:config:get', id),
  setProjectConfig: (request) => ipcRenderer.invoke('textra:config:set', request),
  cleanProjectBuildArtifacts: (projectId) =>
    ipcRenderer.invoke('textra:build:clean-artifacts', projectId),
  cleanAuxiliaryFiles: (request) => ipcRenderer.invoke('textra:build:clean-aux', request),
  exportSettings: () => ipcRenderer.invoke('textra:settings:export'),
  importSettings: () => ipcRenderer.invoke('textra:settings:import'),
  openUserDataFolder: () => ipcRenderer.invoke('textra:appdata:open'),
  openSetupLink: (target) => ipcRenderer.invoke('textra:setup:link', target),
  testDistribution: () => ipcRenderer.invoke('textra:setup:test'),
  getLanguageToolStatus: () => ipcRenderer.invoke('textra:language:status'),
  getTexlabStatus: () => ipcRenderer.invoke('textra:texlab:status'),
  checkTexlab: () => ipcRenderer.invoke('textra:texlab:check'),
  syncTexlabDocument: (request) => ipcRenderer.invoke('textra:texlab:sync', request),
  closeTexlabDocument: (request) => ipcRenderer.invoke('textra:texlab:close', request),
  texlabRequest: (request) => ipcRenderer.invoke('textra:texlab:request', request),
  getTexlabDiagnostics: (request) => ipcRenderer.invoke('textra:texlab:diagnostics', request),
  lintLatex: (request) => ipcRenderer.invoke('textra:language:lint', request),
  formatLatex: (request) => ipcRenderer.invoke('textra:language:format', request),
  openStackExchangeSearch: (query) => ipcRenderer.invoke('textra:language:stackexchange', query),
  openTexFaqHelp: (url) => ipcRenderer.invoke('textra:help:texfaq', url),
  copyText: (text) => ipcRenderer.invoke('textra:clipboard:copy', text),
  listFileHistory: (request) => ipcRenderer.invoke('textra:history:list', request),
  readFileHistorySnapshot: (request) => ipcRenderer.invoke('textra:history:read', request),
  createFileHistorySnapshot: (request) => ipcRenderer.invoke('textra:history:create', request),
  restoreFileHistorySnapshot: (request) => ipcRenderer.invoke('textra:history:restore', request),
  pinFileHistorySnapshot: (request) => ipcRenderer.invoke('textra:history:pin', request),
  exportFileHistorySnapshot: (request) => ipcRenderer.invoke('textra:history:export', request),
  deleteFileHistorySnapshot: (request) => ipcRenderer.invoke('textra:history:delete', request),
};

contextBridge.exposeInMainWorld('textra', Object.freeze(api));
