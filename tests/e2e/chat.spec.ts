import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { AIMessage, AISettings, BuildRequest, BuildState, Result } from '../../src/shared/api';
import type { AIStoredChat } from '../../src/shared/ai';

interface ChatTestState {
  settings: AISettings;
  keyTests: number;
  keyDeletions: number;
  studioOpened: boolean;
  copiedText: string | null;
  storedChats: AIStoredChat[];
  savedChats: Array<{ projectId: string; chat: AIStoredChat }>;
  requests: AIMessage[][];
  activeRequestId?: string;
  release: ((result: Result<string>) => void) | null;
}

test('native Gemini chat onboards, retries, cancels, and reviews Problems before auto-send', async () => {
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
      const state: ChatTestState = {
        settings: { configured: false, autoSendProblems: false },
        keyTests: 0,
        keyDeletions: 0,
        studioOpened: false,
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
        release: null,
      };
      (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest = state;
      for (const name of ['settings', 'key', 'delete', 'auto-send', 'send', 'cancel', 'studio']) {
        ipcMain.removeHandler(`textra:ai:${name}`);
      }
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
      ipcMain.handle('textra:ai:key', () => {
        ++state.keyTests;
        if (state.keyTests === 1 || state.keyTests === 3)
          return { ok: false, error: 'The test key was rejected.' };
        state.settings.configured = true;
        return { ok: true, value: state.settings };
      });
      ipcMain.handle('textra:ai:delete', () => {
        // Simulate native confirmation cancellation, then confirmation on retry.
        if (++state.keyDeletions === 1) return { ok: true, value: null };
        state.settings = { configured: false, autoSendProblems: false };
        return { ok: true, value: state.settings };
      });
      ipcMain.handle('textra:ai:auto-send', (_event, request: { autoSendProblems: boolean }) => {
        state.settings.autoSendProblems = request.autoSendProblems;
        return { ok: true, value: state.settings };
      });
      ipcMain.handle('textra:ai:studio', () => {
        state.studioOpened = true;
        return { ok: true, value: undefined };
      });
      ipcMain.handle(
        'textra:ai:send',
        (_event, request: { messages: AIMessage[]; requestId?: string }) => {
          state.requests.push(request.messages);
          state.activeRequestId = request.requestId;
          if (state.requests.length === 3)
            return { ok: true, value: 'Retry succeeded. Check the missing brace.' };
          return new Promise<Result<string>>((resolve) => {
            state.release = resolve;
          });
        },
      );
      ipcMain.handle('textra:ai:cancel', () => {
        state.release?.({ ok: false, error: 'Cancelled', code: 'AI_CANCELLED' });
        state.release = null;
        return { ok: true, value: undefined };
      });
    });
    const chatRail = page.getByRole('button', { name: 'AI Chat', exact: true });
    await expect(chatRail.locator('svg')).toHaveCount(1);
    const railPlacement = await chatRail.evaluate((element) => {
      const settings = document.querySelector('[aria-label="Settings and TeX setup"]');
      return Boolean(
        settings && element.getBoundingClientRect().bottom < settings.getBoundingClientRect().top,
      );
    });
    expect(railPlacement).toBe(true);
    await chatRail.click();
    const chat = page.getByRole('region', { name: 'AI debugging chat', exact: true });
    await expect(chat.getByRole('heading', { name: 'Debug with Gemini' })).toBeVisible();
    await expect(chat).toContainText('Gemini 3.5 Flash Lite');
    const studio = chat.getByRole('link', { name: 'Google AI Studio', exact: true });
    await expect(studio).toHaveAttribute('href', 'https://aistudio.google.com/');
    await studio.click();
    expect(
      await application.evaluate(
        () => (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.studioOpened,
      ),
    ).toBe(true);
    const keyInput = chat.getByLabel('Gemini API key', { exact: true });
    await expect(keyInput).toHaveAttribute('type', 'password');
    const autoSend = chat.getByRole('checkbox', { name: /Automatically send Problems prompts/ });
    await expect(autoSend).not.toBeChecked();
    await page.screenshot({ path: test.info().outputPath('chat-onboarding.png') });
    await keyInput.fill('AQ.fake-native-test-key');
    await chat.getByRole('button', { name: 'Save & Test Key', exact: true }).click();
    await expect(chat.getByRole('alert')).toHaveText('The test key was rejected.');
    await expect(keyInput).toHaveValue('AQ.fake-native-test-key');
    await expect(chat.getByLabel('Message Gemini')).toHaveCount(0);
    await chat.getByRole('button', { name: 'Save & Test Key', exact: true }).click();
    const composer = chat.getByRole('textbox', { name: 'Message Gemini', exact: true });
    await expect(composer).toBeVisible();
    const headerHeights = await page.evaluate(() =>
      ['.ai-chat-header', '.editor-tab-strip', '.preview-header'].map(
        (selector) => document.querySelector(selector)?.getBoundingClientRect().height,
      ),
    );
    expect(headerHeights[0]).toBe(headerHeights[1]);
    expect(headerHeights[0]).toBe(headerHeights[2]);
    await expect(chat.locator('.ai-chat-header button').first()).toHaveCSS(
      'border-radius',
      '999px',
    );
    await expect(chat.locator('.ai-chat-header button').last()).toHaveCSS('border-radius', '999px');
    await expect(composer).toHaveAttribute('rows', '2');
    const ask = chat.getByRole('button', { name: 'Send message', exact: true });
    await expect(ask).toHaveCSS('border-radius', '999px');
    await expect(ask).toBeDisabled();
    await expect(ask).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const sendBounds = await ask.boundingBox();
    expect(sendBounds).not.toBeNull();
    expect(Math.abs(sendBounds!.width - sendBounds!.height)).toBeLessThan(1);
    expect(sendBounds!.width).toBe(24);
    await expect(ask.locator('svg')).toHaveAttribute('width', '12');
    const composeFrame = chat.locator('.ai-chat-compose');
    await expect(composeFrame.locator('.ai-chat-actions')).toBeVisible();
    await expect(
      composeFrame.getByRole('button', { name: 'Send message', exact: true }),
    ).toBeVisible();
    const model = composeFrame.getByRole('button', {
      name: 'Model',
      exact: true,
    });
    await expect(model).toBeEnabled();
    await expect(model).toHaveAttribute('title', 'Gemini 3.5 Flash Lite');
    await model.click();
    const modelMenu = chat.getByRole('menu', { name: 'AI model', exact: true });
    await expect(modelMenu.getByRole('menuitemradio')).toHaveText([
      'Gemini 3.5 Flash Lite',
      'Gemini 3.1 Flash Lite',
      'Gemini 3.8 Flash',
      'Gemini 3.6 Flash',
      'Gemini 3 Flash (Preview)',
      'Gemma 4 26B',
      'Gemma 4 31B',
    ]);
    await expect(
      modelMenu.getByRole('menuitemradio', { name: 'Gemini 3.5 Flash Lite', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await composer.fill('   ');
    await expect(ask).toBeDisabled();
    await composer.fill('');

    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'AI Chat', exact: true }).click();
    const savedKey = settings.getByText('A tested API key is saved.', { exact: true });
    const replaceKey = settings.getByRole('button', { name: 'Replace key', exact: true });
    const deleteKey = settings.getByRole('button', { name: 'Delete key', exact: true });
    const replacementInput = settings.getByLabel('Replace Gemini API key', { exact: true });
    await expect(savedKey).toBeVisible();
    await expect(replacementInput).toHaveCount(0);
    await expect(replaceKey).toBeVisible();
    await expect(deleteKey).toBeVisible();
    await replaceKey.click();
    await expect(replacementInput).toHaveAttribute('type', 'password');
    await replacementInput.fill('AQ.abandoned-replacement');
    await settings.getByRole('button', { name: 'Cancel replacement', exact: true }).click();
    await expect(replacementInput).toHaveCount(0);
    await replaceKey.click();
    await expect(replacementInput).toHaveValue('');
    await replacementInput.fill('AQ.mock-replacement-key');
    const replaceSubmit = settings.getByRole('button', { name: 'Test & Replace Key', exact: true });
    await replaceSubmit.click();
    await expect(settings.getByRole('alert')).toHaveText('The test key was rejected.');
    await expect(savedKey).toBeVisible();
    await expect(replacementInput).toHaveValue('AQ.mock-replacement-key');
    expect(
      await application.evaluate(
        () =>
          (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.settings
            .configured,
      ),
    ).toBe(true);
    await replaceSubmit.click();
    await expect(savedKey).toBeVisible();
    await expect(replacementInput).toHaveCount(0);
    await expect(settings.getByRole('status')).toContainText(/tested|replaced/i);
    await deleteKey.click();
    await expect(deleteKey).toBeEnabled();
    await expect(savedKey).toBeVisible();
    await expect(replaceKey).toBeVisible();
    await deleteKey.click();
    await expect(savedKey).toHaveCount(0);
    await expect(replaceKey).toHaveCount(0);
    await expect(deleteKey).toHaveCount(0);
    const setupKey = settings.getByLabel('Gemini API key', { exact: true });
    await expect(setupKey).toHaveValue('');
    await setupKey.fill('AQ.reconfigured-native-test-key');
    await settings.getByRole('button', { name: 'Save & Test Key', exact: true }).click();
    await expect(savedKey).toBeVisible();
    await expect(setupKey).toHaveCount(0);
    const settingAutoSend = settings.getByRole('checkbox', {
      name: /Automatically send Problems prompts/,
    });
    await expect(settingAutoSend).not.toBeChecked();
    await settingAutoSend.click();
    await expect(settingAutoSend).toBeChecked();
    await expect(settingAutoSend).toBeEnabled();
    await settingAutoSend.click();
    await expect(settingAutoSend).not.toBeChecked();
    await expect(settingAutoSend).toBeEnabled();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();

    await composer.fill('Why is my LaTeX brace missing?');
    await expect(ask).toBeEnabled();
    await expect(ask).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await composer.press('Control+Enter');
    await expect(chat.getByRole('status')).toContainText('Gemini is thinking');
    await expect(chat.getByRole('button', { name: 'Cancel response', exact: true })).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Cancel response', exact: true })).toHaveText('');
    await expect(chat.locator('.ai-chat-privacy')).toHaveCount(0);
    await expect(chat.locator('.ai-chat-empty')).toHaveCount(0);
    const streamedReply =
      '**Likely cause:** a missing `}`.\n\n```latex\n\\textbf{Fixed}\n```\n\n- Check braces\n- Compile again';
    await application.evaluate(({ BrowserWindow }, text) => {
      const state = (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest;
      BrowserWindow.getAllWindows()[0].webContents.send('textra:ai:chunk', {
        requestId: state.activeRequestId,
        text,
      });
    }, streamedReply);
    const history = chat.getByRole('log', { name: 'Conversation' });
    await expect(history).toHaveCSS('scrollbar-width', 'thin');
    await expect(
      history.getByRole('article', { name: 'Response in progress', exact: true }),
    ).toBeVisible();
    // Prove Markdown is rendered while the IPC response remains unresolved.
    await expect(history.locator('strong').filter({ hasText: 'Likely cause:' })).toBeVisible();
    await expect(history.locator('code').filter({ hasText: '}' }).first()).toBeVisible();
    await expect(history.locator('pre code')).toHaveText('\\textbf{Fixed}');
    await expect(history.getByRole('listitem')).toHaveText(['Check braces', 'Compile again']);
    await expect(history.getByRole('list')).toHaveCSS('list-style-type', 'disc');
    await expect(
      chat.getByRole('button', { name: 'Implement Suggested Fix', exact: true }),
    ).toHaveCount(0);
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
    await expect(
      chat.getByRole('button', { name: 'Implement Suggested Fix', exact: true }),
    ).toBeDisabled();
    const assistant = history.getByRole('article', { name: 'Assistant response', exact: true });
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
    await chat.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(history).toContainText('Add the closing brace after the command argument.');
    await expect(history).toContainText('Why is my LaTeX brace missing?');
    await chat.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(history).toContainText('Add the closing brace after the command argument.');
    await composer.fill('What should I check next?');
    await ask.click();
    await expect(chat.getByRole('button', { name: 'Cancel response', exact: true })).toBeVisible();
    await application.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest;
      BrowserWindow.getAllWindows()[0].webContents.send('textra:ai:chunk', {
        requestId: state.activeRequestId,
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
    await expect(
      chat.getByRole('button', { name: 'Implement Suggested Fix', exact: true }),
    ).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('chat-conversation.png') });
    const requests = await application.evaluate(
      () => (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.requests,
    );
    expect(requests[1]).toEqual(requests[2]);
    expect(requests[1].map((message) => message.role)).toEqual(['user', 'model', 'user']);
    expect(JSON.stringify(requests[2])).not.toContain('Incomplete response before a quota error.');
    await composer.fill('One more question');
    await ask.click();
    await expect(chat.getByRole('status')).toContainText('Gemini is thinking');
    const cancelledRequestId = await application.evaluate(
      () =>
        (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.activeRequestId,
    );
    await chat.getByRole('button', { name: 'Cancel response', exact: true }).click();
    await expect(chat.getByRole('alert')).toContainText('Response cancelled');
    await application.evaluate(({ BrowserWindow }) => {
      const state = (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest;
      BrowserWindow.getAllWindows()[0].webContents.send('textra:ai:chunk', {
        requestId: state.activeRequestId,
        text: 'Late cancelled response must not appear.',
      });
    });
    await expect(history).not.toContainText('Late cancelled response must not appear.');
    await expect(chat.getByRole('button', { name: 'Retry response', exact: true })).toBeVisible();
    await composer.fill('An unsent draft');
    await chat.getByRole('button', { name: 'New chat', exact: true }).click();
    await expect(composer).toHaveValue('An unsent draft');
    await expect(history.locator('article')).toHaveCount(0);
    await expect(history).toContainText('Let’s untangle that error.');
    await expect(chat.getByRole('alert')).toHaveCount(0);

    await composer.fill('A fresh conversation question');
    await ask.click();
    await expect(chat.getByRole('status')).toContainText('Gemini is thinking');
    const freshRequest = await application.evaluate(() =>
      (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.requests.at(-1),
    );
    expect(freshRequest).toEqual([{ role: 'user', text: 'A fresh conversation question' }]);
    await application.evaluate(({ BrowserWindow }, staleRequestId) => {
      const state = (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest;
      const sender = BrowserWindow.getAllWindows()[0].webContents;
      sender.send('textra:ai:chunk', {
        requestId: staleRequestId,
        text: 'Late cancelled response must not appear.',
      });
      sender.send('textra:ai:chunk', {
        requestId: state.activeRequestId,
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
    await historyMenu.getByRole('menuitem', { name: /Earlier troubleshooting/ }).click();
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
    await settings.getByRole('button', { name: 'AI Chat', exact: true }).click();
    await expect(settingAutoSend).not.toBeChecked();
    await settingAutoSend.click();
    await expect(settingAutoSend).toBeChecked();
    await expect(settingAutoSend).toBeEnabled();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await problem.getByRole('button', { name: 'Ask in Chat', exact: true }).click();
    await expect(chat.getByRole('status')).toContainText('Gemini is thinking');
    const autoRequest = await application.evaluate(() =>
      (globalThis as typeof globalThis & { chatTest: ChatTestState }).chatTest.requests.at(-1),
    );
    expect(autoRequest).toEqual([{ role: 'user', text: draft }]);
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
