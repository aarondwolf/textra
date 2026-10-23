import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { AIMessage, AISettings, BuildRequest, BuildState, Result } from '../../src/shared/api';
import type { AIAssistantResult, AIProviderConfiguration, AIStoredChat } from '../../src/shared/ai';

interface ChatTestState {
  settings: AISettings;
  keyTests: number;
  keyDeletions: number;
  linksOpened: string[];
  copiedText: string | null;
  storedChats: AIStoredChat[];
  savedChats: Array<{ projectId: string; chat: AIStoredChat }>;
  requests: AIMessage[][];
  contexts: (string | undefined)[];
  activeRequestId?: string;
  release: ((result: Result<string>) => void) | null;
}

test('native multi-provider chat onboards, retries, cancels, and reviews Problems before auto-send', async () => {
  test.setTimeout(120000);
  const root = join(process.cwd(), 'test-results', 'chat');
  await mkdir(root, { recursive: true });
  const userData = await mkdtemp(join(root, 'user-data-'));
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  environment.TEXTRA_USER_DATA_DIR = userData;
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NO_SANDBOX;
  delete environment.ELECTRON_CLI_ARGS;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env: environment });
    const page = await application.firstWindow();
    // Only the remote AI boundary is mocked. The native window, preload bridge,
    // UI, and non-AI handlers remain real except the explicit clipboard-write
    // and local transcript mocks below. No key is written or sent online;
    // the real clipboard is untouched.
    await application.evaluate(({ ipcMain }) => {
      const providerIds = [
        'google',
        'openai',
        'anthropic',
        'mistral',
        'codestral',
        'deepseek',
        'openrouter',
        'ollama-cloud',
        'ollama-local',
      ] as const;
      const unconfigured = (): AISettings => ({
        configured: false,
        autoSendProblems: false,
        roleDefaults: { assistant: null, completion: null, inlineCompletion: null },
        completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
        providers: providerIds.map((id) => ({
          id,
          configured: false,
          defaultModel: null,
          models: [],
          modelsFetchedAt: null,
          error: null,
        })),
      });
      const connectGoogle = (settings: AISettings): AISettings => ({
        ...settings,
        configured: true,
        roleDefaults: {
          assistant: { provider: 'google', model: 'gemini-3.5-flash-lite' },
          completion: null,
          inlineCompletion: null,
        },
        completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
        providers: settings.providers.map((provider) =>
          provider.id === 'google'
            ? {
                ...provider,
                configured: true,
                defaultModel: 'gemini-3.5-flash-lite',
                modelsFetchedAt: Date.now(),
                models: [
                  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
                  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
                  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
                ],
              }
            : provider,
        ),
      });
      const state: ChatTestState = {
        settings: unconfigured(),
        keyTests: 0,
        keyDeletions: 0,
        linksOpened: [],
        copiedText: null,
        storedChats: [
          {
            id: 'restored-chat',
            title: 'Restored debugging chat',
            updatedAt: 2000,
            messages: [
              { role: 'user', text: 'Restored question' },
              { role: 'model', text: 'Stored answer for this workspace.' },
            ],
          },
          {
            id: 'earlier-chat',
            title: 'Earlier troubleshooting',
            updatedAt: 1000,
            messages: [
              { role: 'user', text: 'An earlier question' },
              { role: 'model', text: 'Earlier saved answer.' },
            ],
          },
        ],
        savedChats: [],
        requests: [],
        contexts: [],
        release: null,
      };
      (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest = state;
      for (const name of [
        'settings',
        'provider:save',
        'provider:configure',
        'models:refresh',
        'provider:remove',
        'auto-send',
        'ollama:status',
        'assistant:run',
        'assistant:cancel',
        'link',
      ]) {
        ipcMain.removeHandler(`textra:ai:${name}`);
      }
      ipcMain.handle('textra:ai:ollama:status', () => ({
        ok: true,
        value: { running: false, version: null, installed: false },
      }));
      ipcMain.handle('textra:ai:settings', () => ({ ok: true, value: state.settings }));
      ipcMain.removeHandler('textra:ai:chats:list');
      ipcMain.removeHandler('textra:ai:chats:save');
      ipcMain.handle('textra:ai:chats:list', () => ({ ok: true, value: state.storedChats }));
      ipcMain.handle(
        'textra:ai:chats:save',
        (_event, request: { projectId: string; chat: AIStoredChat }) => {
          state.savedChats.push(request);
          state.storedChats = [
            request.chat,
            ...state.storedChats.filter((chat) => chat.id !== request.chat.id),
          ];
          return { ok: true, value: undefined };
        },
      );
      ipcMain.removeHandler('textra:clipboard:copy');
      ipcMain.handle('textra:clipboard:copy', (_event, text: string) => {
        state.copiedText = text;
        return { ok: true, value: undefined };
      });
      ipcMain.handle('textra:ai:provider:configure', (_event, request: AIProviderConfiguration) => {
        state.settings = {
          ...state.settings,
          providers: state.settings.providers.map((provider) =>
            provider.id === request.provider
              ? {
                  ...provider,
                  configured: true,
                  enabled: request.enabled,
                  endpoint: request.endpoint,
                  displayName: request.displayName,
                  defaultModel: request.defaultModel,
                  filters: request.filters,
                  supportsTools: request.supportsTools,
                  manualModels: request.manualModels,
                  error: null,
                }
              : provider,
          ),
        };
        return { ok: true, value: state.settings };
      });
      ipcMain.handle('textra:ai:models:refresh', (_event, request: { provider: string }) => {
        ++state.keyTests;
        if (request.provider !== 'google' || state.keyTests === 1)
          return { ok: false, error: 'The test key was rejected.' };
        state.settings = connectGoogle(state.settings);
        return { ok: true, value: state.settings };
      });
      ipcMain.handle('textra:ai:provider:remove', (_event, request: { provider: string }) => {
        if (request.provider === 'codestral') {
          state.settings = unconfigured();
          return { ok: true, value: state.settings };
        }
        // Simulate native confirmation cancellation, then confirmation on retry.
        if (++state.keyDeletions === 1) return { ok: true, value: null };
        state.settings = { ...unconfigured(), autoSendProblems: state.settings.autoSendProblems };
        return { ok: true, value: state.settings };
      });
      ipcMain.handle('textra:ai:auto-send', (_event, request: { autoSendProblems: boolean }) => {
        state.settings.autoSendProblems = request.autoSendProblems;
        return { ok: true, value: state.settings };
      });
      ipcMain.handle('textra:ai:link', (_event, request: { provider: string; link: string }) => {
        state.linksOpened.push(`${request.provider}:${request.link}`);
        return { ok: true, value: undefined };
      });
      // The assistant run is mocked; text results are wrapped as plain answers.
      const answer = (result: Result<string>): Result<AIAssistantResult> =>
        result.ok
          ? { ok: true, value: { text: result.value, proposal: null, documentAccess: 'none' } }
          : result;
      ipcMain.handle(
        'textra:ai:assistant:run',
        (_event, request: { messages: AIMessage[]; requestId: string; contextId?: string }) => {
          state.requests.push(request.messages);
          state.contexts.push(request.contextId);
          state.activeRequestId = request.requestId;
          if (state.requests.length === 3)
            return answer({ ok: true, value: 'Retry succeeded. Check the missing brace.' });
          return new Promise<Result<AIAssistantResult>>((resolve) => {
            state.release = (result) => resolve(answer(result));
          });
        },
      );
      ipcMain.handle('textra:ai:assistant:cancel', () => {
        state.release?.({ ok: false, error: 'Cancelled', code: 'AI_CANCELLED' });
        state.release = null;
        return { ok: true, value: undefined };
      });
    });
    const chatRail = page.getByRole('button', { name: 'AI Chat', exact: true });
    await expect(chatRail).toBeVisible();
    const railPlacement = await chatRail.evaluate((element) => {
      const settings = document.querySelector('[aria-label="Settings and TeX setup"]');
      return Boolean(
        settings && element.getBoundingClientRect().bottom < settings.getBoundingClientRect().top,
      );
    });
    expect(railPlacement).toBe(true);
    await chatRail.click();
    const chat = page.getByRole('region', { name: 'AI assistant', exact: true });
    await expect(chat).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('textra-ai-settings-changed')));
    await expect(chat.getByText('Set up AI', { exact: true })).toBeVisible();
    await expect(chat.getByRole('textbox')).toHaveCount(0);
    await chat.getByRole('button', { name: 'Configure AI', exact: true }).click();
    const aiDialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(aiDialog).toBeVisible();
    await expect(aiDialog.locator('.ai-provider-connection')).toHaveCount(0);
    await expect(
      aiDialog.getByRole('button', { name: /^Automatic completion.*model:/ }),
    ).toHaveCount(0);
    await aiDialog.getByRole('button', { name: 'Add provider', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: 'Add provider', exact: true });
    for (const name of ['Google Gemini', 'Mistral', 'DeepSeek', 'OpenRouter', 'OpenAI-compatible'])
      await expect(chooser.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(chooser.getByRole('button', { name: 'Codestral', exact: true })).toHaveCount(0);
    await chooser.getByRole('button', { name: 'Google Gemini', exact: true }).click();
    const providerEditor = page.getByRole('dialog', { name: /^(Add|Edit) Google Gemini$/ });
    const keyInput = providerEditor.getByLabel('Google AI Studio API key', { exact: true });
    await expect(keyInput).toHaveAttribute('type', 'password');
    await providerEditor.getByRole('button', { name: 'Get a key', exact: true }).click();
    expect(
      await application.evaluate(
        () => (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.linksOpened,
      ),
    ).toEqual(['google:keys']);
    await keyInput.fill('AQ.fake-native-test-key');
    await providerEditor.getByRole('button', { name: 'Save Google Gemini', exact: true }).click();
    const google = aiDialog.getByRole('region', { name: 'Google Gemini', exact: true });
    await expect(google).toContainText('0 assistant');
    expect(
      await application.evaluate(
        () => (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.keyTests,
      ),
    ).toBe(0);
    await google.getByRole('button', { name: 'Edit Google Gemini', exact: true }).click();
    await providerEditor
      .getByRole('button', { name: 'Test / Refresh models', exact: true })
      .click();
    await expect(providerEditor.getByRole('alert')).toHaveText('The test key was rejected.');
    await providerEditor
      .getByRole('button', { name: 'Test / Refresh models', exact: true })
      .click();
    await expect(providerEditor.getByRole('status')).toHaveText(
      'Connection tested. Models refreshed.',
    );
    await providerEditor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(google).toContainText('3 assistant');
    // The switch is controlled by the saved settings, so its state changes after the save.
    const googleEnabled = google.getByRole('switch', {
      name: 'Google Gemini enabled',
      exact: true,
    });
    await googleEnabled.click();
    await expect(googleEnabled).not.toBeChecked();
    await expect(google).toContainText('Disabled');
    await googleEnabled.click();
    await expect(googleEnabled).toBeChecked();
    const autoSend = aiDialog.getByRole('checkbox', {
      name: /Automatically send Problems prompts/,
    });
    await expect(autoSend).not.toBeChecked();
    await expect(
      aiDialog.getByRole('button', { name: /^Assistant model: Gemini 3.5 Flash Lite/ }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('chat-onboarding.png') });
    await aiDialog.getByRole('button', { name: 'Close settings', exact: true }).click();
    const composer = chat.getByRole('textbox', { name: 'Message the assistant', exact: true });
    await expect(composer).toBeVisible();
    const headerHeights = await page.evaluate(() =>
      ['.ai-chat-header', '.editor-tab-strip', '.preview-header'].map(
        (selector) => document.querySelector(selector)?.getBoundingClientRect().height,
      ),
    );
    expect(headerHeights[0]).toBe(headerHeights[1]);
    expect(headerHeights[0]).toBe(headerHeights[2]);
    await expect(chat.locator('.ai-chat-header button').first()).toHaveCSS('border-radius', '4px');
    await expect(chat.locator('.ai-chat-header button').last()).toHaveCSS('border-radius', '4px');
    await expect(composer).toHaveAttribute('rows', '2');
    const ask = chat.getByRole('button', { name: 'Send message', exact: true });
    await expect(ask).toHaveCSS('border-radius', '999px');
    await expect(ask).toBeDisabled();
    await expect(chat.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(chat.locator('.ai-context-chip')).toHaveCount(0);
    await expect(ask).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const sendBounds = await ask.boundingBox();
    expect(sendBounds).not.toBeNull();
    expect(Math.abs(sendBounds!.width - sendBounds!.height)).toBeLessThan(1);
    expect(sendBounds!.width).toBe(24);
    await expect(ask.locator('svg')).toHaveAttribute('width', '12');
    const composeFrame = chat.locator('.ai-chat-compose');
    await expect(composeFrame.locator('.ai-chat-actions')).toBeVisible();
    const model = composeFrame.getByRole('button', { name: /^Model: / });
    await expect(model).toBeEnabled();
    await expect(model).toHaveAccessibleName('Model: Gemini 3.5 Flash Lite');
    await model.click();
    const search = chat.getByRole('combobox', { name: 'Search model', exact: true });
    await expect(search).toBeFocused();
    const options = chat.getByRole('listbox', { name: 'Model', exact: true }).getByRole('option');
    await expect(options).toHaveCount(3);
    await search.fill('gemma');
    await expect(options).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(model).toHaveAccessibleName('Model: Gemma 4 26B');
    await model.click();
    await chat.getByRole('combobox', { name: 'Search model', exact: true }).fill('3.5 lite');
    await page.keyboard.press('Enter');
    await expect(model).toHaveAccessibleName('Model: Gemini 3.5 Flash Lite');
    await composer.fill('   ');
    await expect(ask).toBeDisabled();
    await composer.fill('');

    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'AI Settings', exact: true }).click();
    const aiSettingsInline = settings.locator('.ai-settings-inline');
    const googleCard = aiSettingsInline.getByRole('region', { name: 'Google Gemini', exact: true });
    const remove = googleCard.getByRole('button', { name: 'Delete Google Gemini', exact: true });
    await remove.click();
    await expect(googleCard).toBeVisible();
    await remove.click();
    await expect(googleCard).toHaveCount(0);
    await aiSettingsInline.getByRole('button', { name: 'Add provider', exact: true }).click();
    await chooser.getByRole('button', { name: 'Google Gemini', exact: true }).click();
    await providerEditor
      .getByLabel('Google AI Studio API key', { exact: true })
      .fill('AQ.reconfigured-native-test-key');
    await providerEditor
      .getByRole('button', { name: 'Test / Refresh models', exact: true })
      .click();
    await expect(providerEditor.getByRole('status')).toHaveText(
      'Connection tested. Models refreshed.',
    );
    await providerEditor.getByRole('button', { name: 'Save Google Gemini', exact: true }).click();
    await expect(googleCard).toContainText('3 assistant');
    const settingAutoSend = aiSettingsInline.getByRole('checkbox', {
      name: /Automatically send Problems prompts/,
    });
    await expect(settingAutoSend).not.toBeChecked();
    await settingAutoSend.click();
    await expect(settingAutoSend).toBeChecked();
    await settingAutoSend.click();
    await expect(settingAutoSend).not.toBeChecked();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();

    // Removing a provider clears its temporary role binding. Reconnecting must
    // not silently revive that choice; the user explicitly chooses again.
    await model.click();
    await chat.getByRole('combobox', { name: 'Search model', exact: true }).fill('3.5 lite');
    await page.keyboard.press('Enter');
    await composer.fill('Why is my LaTeX brace missing?\n\n```tex\n\\usepackage{lipsum}\n```');
    await expect(ask).toBeEnabled();
    await expect(ask).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await composer.press('Control+Enter');
    await expect(chat.getByRole('status')).toContainText('Thinking');
    await expect(chat.getByRole('button', { name: 'Cancel response', exact: true })).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Cancel response', exact: true })).toHaveText('');
    await expect(chat.locator('.ai-message-user pre code')).toHaveText('\\usepackage{lipsum}');
    const userCodeCopy = chat.getByRole('article', { name: 'Your message' }).getByRole('button', {
      name: 'Copy code',
      exact: true,
    });
    await expect(userCodeCopy).toBeVisible();
    await userCodeCopy.click();
    expect(
      await application.evaluate(
        () => (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.copiedText,
      ),
    ).toBe('\\usepackage{lipsum}');
    await expect(chat.locator('.ai-chat-privacy')).toHaveCount(0);
    await expect(chat.locator('.ai-chat-empty')).toHaveCount(0);
    const streamedReply =
      '**Likely cause:** a missing `}`.\n\n```latex\n\\textbf{Fixed}\n```\n\n- Check braces\n- Compile again';
    await application.evaluate(({ BrowserWindow }, text) => {
      const state = (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest;
      BrowserWindow.getAllWindows()[0].webContents.send('textra:ai:assistant:event', {
        requestId: state.activeRequestId,
        type: 'text',
        text,
      });
    }, streamedReply);
    await application.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest;
      BrowserWindow.getAllWindows()[0].webContents.send('textra:ai:assistant:event', {
        requestId: state.activeRequestId,
        type: 'reasoning',
        text: 'I will check the brace structure before answering.',
      });
    });
    const history = chat.getByRole('log', { name: 'Conversation' });
    expect(
      await history.evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar').width),
    ).toBe('5px');
    await expect(
      history.getByRole('article', { name: 'Response in progress', exact: true }),
    ).toBeVisible();
    const streamingReasoning = history.locator('details.ai-reasoning');
    await expect(streamingReasoning).toBeVisible();
    await expect(streamingReasoning).not.toHaveJSProperty('open', true);
    await expect(streamingReasoning).toContainText(
      'I will check the brace structure before answering.',
    );
    // Prove Markdown is rendered while the IPC response remains unresolved.
    await expect(history.locator('strong').filter({ hasText: 'Likely cause:' })).toBeVisible();
    await expect(history.locator('code').filter({ hasText: '}' }).first()).toBeVisible();
    await expect(history.locator('.ai-message-model pre code')).toHaveText('\\textbf{Fixed}');
    await expect(
      history.getByRole('article', { name: 'Response in progress' }).getByRole('button', {
        name: 'Copy code',
        exact: true,
      }),
    ).toBeVisible();
    await expect(history.getByRole('listitem')).toHaveText(['Check braces', 'Compile again']);
    await expect(history.getByRole('list')).toHaveCSS('list-style-type', 'disc');
    await page.screenshot({ path: test.info().outputPath('chat-streaming-markdown.png') });
    const completedReply = `${streamedReply}\n\n**Suggested fix:** Add the closing brace after the command argument.`;
    await application.evaluate((_electron, text) => {
      const state = (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest;
      state.release?.({ ok: true, value: text });
      state.release = null;
    }, completedReply);
    await expect(history).toContainText('Why is my LaTeX brace missing?');
    await expect(history).toContainText('Add the closing brace after the command argument.');
    await expect(history.getByRole('article', { name: 'Response in progress' })).toHaveCount(0);
    await expect(history.locator('strong').filter({ hasText: 'Likely cause:' })).toHaveCount(1);
    const assistant = history.getByRole('article', { name: 'Assistant response', exact: true });
    await expect(assistant.locator('details.ai-reasoning')).not.toHaveJSProperty('open', true);
    await expect(assistant.locator('details.ai-reasoning')).toContainText(
      'I will check the brace structure before answering.',
    );
    await expect(assistant).toHaveCSS('border-top-width', '0px');
    await expect(assistant).toHaveCSS('padding', '0px');
    await expect(assistant.getByText('Gemini', { exact: true })).toHaveCount(0);
    await expect(assistant.getByRole('button', { name: 'Copy response', exact: true })).toHaveText(
      '',
    );
    await assistant.getByRole('button', { name: 'Copy response', exact: true }).click();
    await expect(
      assistant.getByRole('button', { name: 'Copied response', exact: true }),
    ).toBeVisible();
    expect(
      await application.evaluate(
        () => (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.copiedText,
      ),
    ).toBe(completedReply);
    // Chat and Agent share the assistant; suggested fixes remain ordinary follow-ups.
    await expect(chat.getByRole('button', { name: 'Chat', exact: true })).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Agent', exact: true })).toBeVisible();
    await expect(
      chat.getByRole('button', { name: 'Implement Suggested Fix', exact: true }),
    ).toHaveCount(0);
    await composer.fill('What should I check next?');
    await ask.click();
    await expect(chat.getByRole('button', { name: 'Cancel response', exact: true })).toBeVisible();
    await application.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest;
      BrowserWindow.getAllWindows()[0].webContents.send('textra:ai:assistant:event', {
        requestId: state.activeRequestId,
        type: 'text',
        text: 'Incomplete response before a quota error.',
      });
    });
    await expect(history).toContainText('Incomplete response before a quota error.');
    await application.evaluate(() => {
      const state = (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest;
      state.release?.({ ok: false, error: 'Quota exceeded', code: 'AI_RATE_LIMIT' });
      state.release = null;
    });
    await expect(chat.getByRole('alert')).toContainText('rate or quota limit');
    await expect(
      history.getByRole('article', { name: 'Incomplete response', exact: true }),
    ).toContainText('Incomplete response before a quota error.');
    await chat.getByRole('button', { name: 'Retry response', exact: true }).click();
    await expect(history).toContainText('Retry succeeded. Check the missing brace.');
    await page.screenshot({ path: test.info().outputPath('chat-conversation.png') });
    const requests = await application.evaluate(
      () => (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.requests,
    );
    expect(requests[1]).toEqual(requests[2]);
    expect(requests[1].map((message) => message.role)).toEqual(['user', 'model', 'user']);
    expect(JSON.stringify(requests[2])).not.toContain('Incomplete response before a quota error.');
    await composer.fill('One more question');
    await ask.click();
    await expect(chat.getByRole('status')).toContainText('Thinking');
    const cancelledRequestId = await application.evaluate(
      () =>
        (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.activeRequestId,
    );
    await chat.getByRole('button', { name: 'Cancel response', exact: true }).click();
    await expect(chat.getByRole('alert')).toContainText('Response cancelled');
    await application.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest;
      BrowserWindow.getAllWindows()[0].webContents.send('textra:ai:assistant:event', {
        requestId: state.activeRequestId,
        type: 'text',
        text: 'Late cancelled response must not appear.',
      });
    });
    await expect(history).not.toContainText('Late cancelled response must not appear.');
    await expect(chat.getByRole('button', { name: 'Retry response', exact: true })).toBeVisible();
    await composer.fill('An unsent draft');
    await chat.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(composer).toHaveValue('An unsent draft');
    await expect(history.locator('article')).toHaveCount(0);
    await expect(history).toContainText('Ask a question or describe a change to the open file.');
    await expect(chat.getByRole('alert')).toHaveCount(0);

    await composer.fill('A fresh conversation question');
    await ask.click();
    await expect(chat.getByRole('status')).toContainText('Thinking');
    const freshRequest = await application.evaluate(() =>
      (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.requests.at(-1),
    );
    expect(freshRequest).toEqual([{ role: 'user', text: 'A fresh conversation question' }]);
    await application.evaluate(({ BrowserWindow }, staleRequestId) => {
      const state = (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest;
      const sender = BrowserWindow.getAllWindows()[0].webContents;
      sender.send('textra:ai:assistant:event', {
        requestId: staleRequestId,
        type: 'text',
        text: 'Late cancelled response must not appear.',
      });
      sender.send('textra:ai:assistant:event', {
        requestId: state.activeRequestId,
        type: 'text',
        text: 'Fresh response preview.',
      });
    }, cancelledRequestId);
    await expect(history).toContainText('Fresh response preview.');
    await expect(history).not.toContainText('Late cancelled response must not appear.');
    await chat.getByRole('button', { name: 'Cancel response', exact: true }).click();
    await expect(chat.getByRole('alert')).toContainText('Response cancelled');
    await chat.getByRole('button', { name: 'New chat', exact: true }).click();

    // Use real project files and project IPC. Only the native folder chooser and
    // compilation result/state are additionally mocked to avoid requiring a TeX toolchain.
    const projectRoot = join(userData, 'debugging-project');
    await mkdir(projectRoot);
    const lines = Array.from({ length: 16 }, (_, index) => `% source line ${index + 1}`);
    lines[0] = '\\documentclass{article}';
    lines[1] = '\\begin{document}';
    lines[7] = '\\unknowncommand{Selected failing line}';
    lines[15] = '\\end{document}';
    await writeFile(join(projectRoot, 'main.tex'), lines.join('\n'));
    await application.evaluate(({ dialog, ipcMain }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
      let buildState: BuildState = {
        running: false,
        outcome: 'idle',
        log: '',
        diagnostics: [],
        pdfPath: null,
        projectId: null,
        rootFile: null,
      };
      ipcMain.removeHandler('textra:build:state');
      ipcMain.handle('textra:build:state', (): Result<BuildState> => ({
        ok: true,
        value: buildState,
      }));
      ipcMain.removeHandler('textra:build:compile');
      ipcMain.handle(
        'textra:build:compile',
        (_event, request: BuildRequest): Result<BuildState> => {
          buildState = {
            running: false,
            outcome: 'failed',
            log: '! Undefined control sequence.\nl.8 \\unknowncommand',
            diagnostics: [
              {
                severity: 'error',
                source: 'build',
                file: 'main.tex',
                line: 8,
                message: 'Undefined control sequence in debugging fixture.',
              },
            ],
            pdfPath: null,
            projectId: request.projectId,
            rootFile: request.rootFile,
          };
          return { ok: true, value: buildState };
        },
      );
    }, projectRoot);
    await page.getByRole('button', { name: 'File Explorer', exact: true }).click();
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
    await expect(history).toContainText('Stored answer for this workspace.');
    await expect(history).toContainText('Restored question');
    const historyButton = chat.getByRole('button', { name: 'Chat history', exact: true });
    await expect(historyButton).toBeEnabled();
    await chat.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(history.locator('article')).toHaveCount(0);
    await historyButton.click();
    const historyMenu = chat.getByRole('menu', { name: 'Workspace chat history', exact: true });
    await historyMenu.getByRole('menuitem', { name: /^Earlier troubleshooting/ }).click();
    await expect(history).toContainText('Earlier saved answer.');
    await expect(history).not.toContainText('Stored answer for this workspace.');
    await chat.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(history.locator('article')).toHaveCount(0);
    const savedTranscripts = await application.evaluate(
      () => (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.savedChats,
    );
    expect(
      savedTranscripts.some(
        ({ chat }) =>
          chat.id === 'restored-chat' &&
          chat.messages[1]?.text === 'Stored answer for this workspace.',
      ),
    ).toBe(true);
    expect(
      savedTranscripts.some(
        ({ chat }) =>
          chat.id === 'earlier-chat' && chat.messages[1]?.text === 'Earlier saved answer.',
      ),
    ).toBe(true);
    await expect(composer).toHaveValue('');
    await page.getByRole('button', { name: 'Compile active document', exact: true }).click();
    await page.getByRole('tab', { name: 'Problems', exact: true }).click();
    const problem = page
      .getByRole('region', { name: 'Problems', exact: true })
      .getByRole('listitem')
      .filter({
        hasText: 'Undefined control sequence in debugging fixture.',
      });
    await problem.getByRole('button', { name: 'Ask in Chat', exact: true }).click();
    await expect(composer).toHaveValue(/Undefined control sequence in debugging fixture\./);
    await expect(chat.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(chat.locator('.ai-context-chip')).toHaveCount(0);
    const draft = await composer.inputValue();
    expect(draft).toContain('main.tex:8');
    expect(draft).toContain('Lines 3-13:');
    expect(draft).toContain('> 8: \\unknowncommand{Selected failing line}');
    expect(draft).toContain('3: % source line 3');
    expect(draft).toContain('13: % source line 13');
    expect(draft).not.toContain('2: \\begin{document}');
    expect(draft).not.toContain('14: % source line 14');
    expect(
      await application.evaluate(
        () =>
          (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.requests.length,
      ),
    ).toBe(5);
    await composer.fill(`Please review this before sharing.\n${draft}`);
    await expect(composer).toHaveValue(`Please review this before sharing.\n${draft}`);
    await composer.fill('');
    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    await settings.getByRole('button', { name: 'AI Settings', exact: true }).click();
    const aiSettingsForPrefs = settings.locator('.ai-settings-inline');
    const settingAutoSendInline = aiSettingsForPrefs.getByRole('checkbox', {
      name: /Automatically send Problems prompts/,
    });
    await expect(settingAutoSendInline).not.toBeChecked();
    await settingAutoSendInline.click();
    await expect(settingAutoSendInline).toBeChecked();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await problem.getByRole('button', { name: 'Ask in Chat', exact: true }).click();
    await expect(chat.getByRole('status')).toContainText('Thinking');
    const autoRequest = await application.evaluate(() =>
      (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.requests.at(-1),
    );
    expect(autoRequest).toEqual([{ role: 'user', text: draft }]);
    // Automatically sent Problems prompts stay tool-free: no document context is attached.
    expect(
      await application.evaluate(() =>
        (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.contexts.at(-1),
      ),
    ).toBeUndefined();
    await expect(composer).toHaveValue('');
    await chat.getByRole('button', { name: 'Cancel response', exact: true }).click();
    await expect(chat.getByRole('alert')).toContainText('Response cancelled');
  } finally {
    if (application) {
      await application
        .evaluate(({ app }) => {
          setImmediate(() => app.exit(0));
        })
        .catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
