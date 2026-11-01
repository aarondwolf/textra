import { dialog, shell } from 'electron';
import { AI_PROVIDERS, isAIProviderId } from '../../shared/ai';
import { AIError, validateCompletionRequest } from '../services/ai-service';
import { validateInlineEditRequest } from '../services/ai-inline-edit';
import { deleteChatRequestSchema } from '../services/ai-chats';
import type { IpcHandlers, IpcServices } from './types';

/** Registers AI capabilities through the same trusted, lifecycle-aware IPC boundary. */
export function registerAiIpc(
  { handle, handleRequest }: IpcHandlers,
  { ai, inlineEdits, agentWorkspace, aiChats, workspace, projects, requireWindow }: IpcServices,
): void {
  handle('textra:ai:settings', 0, () => ai.settings());
  handle('textra:ai:prepare', 0, () => ai.prepare());
  handleRequest<'configureAIProvider'>('textra:ai:provider:configure', (request) =>
    ai.configureProvider(request),
  );
  handleRequest<'requestAIInlineEdit'>('textra:ai:inline-edit:request', async (request) => {
    const generation = workspace.generation;
    validateInlineEditRequest(request);
    await projects.resolvePath({ projectId: request.projectId, path: request.path });
    workspace.assertCurrent(generation);
    const receiver = requireWindow().webContents;
    const requestId = request.requestId;
    return inlineEdits.request(request, (text) => {
      if (!receiver.isDestroyed())
        receiver.send('textra:ai:inline-edit:chunk', { requestId, text: text.slice(0, 32_000) });
    });
  });
  handleRequest<'cancelAIInlineEdit'>('textra:ai:inline-edit:cancel', (request) =>
    inlineEdits.cancel(request),
  );
  handleRequest<'saveAIProvider'>('textra:ai:provider:save', (request) => ai.saveProvider(request));
  handleRequest<'removeAIProvider'>('textra:ai:provider:remove', async (request) => {
    const provider = request && isAIProviderId(request.provider) ? request.provider : null;
    if (!provider) throw new AIError('INVALID_ARGUMENT', 'Choose a supported AI provider.');
    const info = AI_PROVIDERS[provider];
    const answer = await dialog.showMessageBox(requireWindow(), {
      type: 'question',
      title: `Remove ${info.label}?`,
      message: `Remove the ${info.label} connection from TeXtra?`,
      detail:
        provider === 'ollama-local'
          ? 'Its models leave the model list. Ollama itself and your downloaded models are not affected.'
          : 'Its models and role bindings are removed. Any saved API key is deleted locally; it is not revoked with the provider.',
      buttons: ['Cancel', 'Remove'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return answer.response === 1 ? ai.removeProvider(request) : null;
  });
  handleRequest<'refreshAIModels'>('textra:ai:models:refresh', (request) =>
    ai.refreshModels(request),
  );
  handleRequest<'setAIProviderDefault'>('textra:ai:provider:default', (request) =>
    ai.setProviderDefault(request),
  );
  handleRequest<'setAIRoleDefault'>('textra:ai:role-default', (request) =>
    ai.setRoleDefault(request),
  );
  handleRequest<'setAICompletionSettings'>('textra:ai:completion:settings', (request) =>
    ai.setCompletionSettings(request),
  );
  handleRequest<'requestAICompletion'>('textra:ai:completion:request', async (request) => {
    const generation = workspace.generation;
    validateCompletionRequest(request);
    await projects.resolvePath({ projectId: request.projectId, path: request.path });
    workspace.assertCurrent(generation);
    return ai.complete(request);
  });
  handleRequest<'cancelAICompletion'>('textra:ai:completion:cancel', (request) =>
    ai.cancelCompletion(request),
  );
  handleRequest<'setAIAutoSend'>('textra:ai:auto-send', (request) => ai.setAutoSend(request));
  handle('textra:ai:ollama:status', 0, () => ai.ollamaStatus());
  handle('textra:ai:ollama:start', 0, () => ai.startOllama());
  handleRequest<'syncAIAgentDocument'>('textra:agent:document', (request) =>
    agentWorkspace.sync(request),
  );
  handleRequest<'runAIAssistant'>('textra:ai:assistant:run', (request) => {
    const receiver = requireWindow().webContents;
    return agentWorkspace.run(request, (event) => {
      // Display-only events: bounded text and status, never tool payloads or provider data.
      if (!receiver.isDestroyed()) receiver.send('textra:ai:assistant:event', event);
    });
  });
  handleRequest<'cancelAIAssistant'>('textra:ai:assistant:cancel', (request) =>
    agentWorkspace.cancel(request),
  );
  handleRequest<'acceptAIAgentProposal'>('textra:agent:accept', (request) =>
    agentWorkspace.accept(request),
  );
  handleRequest<'rejectAIAgentProposal'>('textra:agent:reject', (request) =>
    agentWorkspace.reject(request),
  );
  handleRequest<'reviewAIAgentProposal'>('textra:agent:review', (request) =>
    agentWorkspace.review(request),
  );
  handleRequest<'openAIProviderLink'>('textra:ai:link', (request) => {
    const url =
      request && isAIProviderId(request.provider) && typeof request.link === 'string'
        ? AI_PROVIDERS[request.provider].links[request.link]
        : undefined;
    if (!url) throw new AIError('INVALID_ARGUMENT', 'That provider link is not available.');
    return shell.openExternal(url);
  });
  handleRequest<'listAIChats'>('textra:ai:chats:list', (projectId) => aiChats.list(projectId));
  handleRequest<'saveAIChat'>('textra:ai:chats:save', (request) => aiChats.save(request));
  handleRequest<'deleteAIChat'>('textra:ai:chats:delete', async (request) => {
    const parsed = deleteChatRequestSchema.safeParse(request);
    if (!parsed.success) throw new AIError('AI_CHAT_STORAGE', 'Provide a valid workspace chat ID.');
    const chat = (await aiChats.list(parsed.data.projectId)).find(
      (item) => item.id === parsed.data.chatId,
    );
    if (!chat) return false;
    const answer = await dialog.showMessageBox(requireWindow(), {
      type: 'warning',
      title: 'Delete saved chat?',
      message: `Permanently delete “${chat.title}”?`,
      detail:
        'This removes only the saved TeXtra chat history. It does not affect your LaTeX files.',
      buttons: ['Cancel', 'Delete chat'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response !== 1) return false;
    return aiChats.deleteChat(parsed.data);
  });
}
