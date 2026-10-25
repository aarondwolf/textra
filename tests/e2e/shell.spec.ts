import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('native shell keeps security boundaries and persists representative UI actions', async () => {
  test.setTimeout(120000); // Includes two real Windows process launches and profile cleanup.
  const root = join(process.cwd(), 'test-results', 'electron');
  await mkdir(root, { recursive: true });
  const userData = await mkdtemp(join(root, 'user-data-'));
  let application: ElectronApplication | undefined;
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  environment.TEXTRA_USER_DATA_DIR = userData;
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NO_SANDBOX;
  delete environment.ELECTRON_CLI_ARGS;
  const launch = () =>
    electron.launch({
      args: ['.'],
      env: environment,
    });

  try {
    application = await launch();
    const page = await application.firstWindow();
    await expect(page.getByRole('main', { name: 'Document workspace' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Project sidebar' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('native-shell.png') });
    expect(await page.evaluate(() => 'require' in window)).toBe(false);
    expect(await page.evaluate(() => 'process' in window)).toBe(false);
    expect(await page.evaluate(() => 'ipcRenderer' in window)).toBe(false);
    const invalidChatRequest = await page.evaluate(() =>
      window.textra.runAIAssistant({
        messages: [{ role: 'user', text: 'Do not send this invalid request.' }],
        requestId: '../invalid-request-id',
        model: { provider: 'google', model: 'gemini-3.5-flash-lite' },
      }),
    );
    expect(invalidChatRequest).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' });
    const cancelledDeletion = await application.evaluate(async ({ dialog, BrowserWindow }) => {
      const original = dialog.showMessageBox;
      let confirmedPrompt = false;
      dialog.showMessageBox = async () => {
        confirmedPrompt = true;
        return { response: 0, checkboxChecked: false };
      };
      try {
        const result: unknown =
          await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
            "window.textra.removeAIProvider({ provider: 'google' })",
          );
        return { result, confirmedPrompt };
      } finally {
        dialog.showMessageBox = original;
      }
    });
    expect(cancelledDeletion).toEqual({ result: { ok: true, value: null }, confirmedPrompt: true });
    expect(await page.evaluate(() => Object.keys(window.textra).sort())).toEqual([
      'acceptAIAgentProposal',
      'acknowledgeBeforeClose',
      'cancelAIAssistant',
      'cancelAICompletion',
      'cancelAIInlineEdit',
      'cancelBuild',
      'cancelLanguageRequest',
      'checkTexlab',
      'chooseProject',
      'chooseToolPath',
      'cleanAuxiliaryFiles',
      'cleanProjectBuildArtifacts',
      'closeTexlabDocument',
      'compile',
      'configureAIProvider',
      'controlWindow',
      'copyEntryPath',
      'copyText',
      'createConflictCopy',
      'createEntry',
      'createFileHistorySnapshot',
      'deleteAIChat',
      'deleteEntry',
      'deleteFileHistorySnapshot',
      'detectTools',
      'exportFileHistorySnapshot',
      'exportSettings',
      'formatLatex',
      'getAISettings',
      'getAppInfo',
      'getBuildState',
      'getFileRevisions',
      'getLanguageToolStatus',
      'getOllamaStatus',
      'getPreferences',
      'getProjectConfig',
      'getRecentProjects',
      'getTexlabDiagnostics',
      'getTexlabStatus',
      'getWindowState',
      'importLegacyFileHistory',
      'importSettings',
      'lintLatex',
      'listAIChats',
      'listFileHistory',
      'listLegacyFileHistories',
      'onAIAssistantEvent',
      'onAIInlineEditChunk',
      'onBeforeClose',
      'onCloseCancelled',
      'onExternalFileChange',
      'onWindowState',
      'openAIProviderLink',
      'openInCode',
      'openRecentProject',
      'openSetupLink',
      'openStackExchangeSearch',
      'openTexFaqHelp',
      'openUserDataFolder',
      'pinFileHistorySnapshot',
      'prepareAI',
      'prepareProject',
      'readFile',
      'readFileHistorySnapshot',
      'readPdf',
      'readProjectPdf',
      'refreshAIModels',
      'refreshProject',
      'rejectAIAgentProposal',
      'removeAIProvider',
      'renameEntry',
      'requestAICompletion',
      'requestAIInlineEdit',
      'restoreFileHistorySnapshot',
      'restoreLastPdf',
      'revealEntry',
      'reviewAIAgentProposal',
      'runAIAssistant',
      'saveAIChat',
      'saveAIProvider',
      'saveFile',
      'setAIAutoSend',
      'setAICompletionSettings',
      'setAIProviderDefault',
      'setAIRoleDefault',
      'setDirty',
      'setPreferences',
      'setProjectConfig',
      'setProjectPinned',
      'startOllama',
      'syncAIAgentDocument',
      'syncForward',
      'syncInverse',
      'syncTexlabDocument',
      'testDistribution',
      'texlabRequest',
      'unwatchExternalFile',
      'watchExternalFile',
    ]);

    await expect(page.locator('.topbar, .statusbar, .bottom-panel')).toHaveCount(0);
    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    await page.getByRole('button', { name: 'Theme', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Project sidebar' })).toBeHidden();

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox', { name: 'Search commands' }).fill('preview');
    await palette.getByRole('option', { name: 'Toggle preview pane', exact: true }).click();
    await expect(palette).toBeHidden();
    await expect(page.getByRole('button', { name: 'Show PDF preview', exact: true })).toBeVisible();

    await expect
      .poll(async () => {
        const result = await page.evaluate(() => window.textra.getPreferences());
        return result.ok ? result.value : undefined;
      })
      .toMatchObject({ theme: 'light', sidebarVisible: false, previewVisible: false });
    await application.close();
    application = await launch();
    const restored = await application.firstWindow();
    await expect(restored.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(
      restored.getByRole('button', { name: 'Toggle sidebar', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(
      restored.getByRole('button', { name: 'Show PDF preview', exact: true }),
    ).toBeVisible();
    await restored.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    await expect(restored.getByRole('button', { name: 'Theme', exact: true })).toContainText(
      'Light',
    );
    await restored.getByRole('button', { name: 'Close settings', exact: true }).click();
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
