import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('native shell keeps security boundaries and persists representative UI actions', async () => {
  test.setTimeout(90000); // Includes two real Windows process launches and profile cleanup.
  const root = join(process.cwd(), 'test-results', 'electron');
  await mkdir(root, { recursive: true });
  const userData = await mkdtemp(join(root, 'user-data-'));
  let application: ElectronApplication | undefined;
  const environment: Record<string, string> = { TEXTRA_USER_DATA_DIR: userData };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
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
    expect(await page.evaluate(() => Object.keys(window.textra).sort())).toEqual([
      'cancelBuild',
      'chooseProject',
      'compile',
      'createEntry',
      'deleteEntry',
      'detectTools',
      'exportSettings',
      'getAppInfo',
      'getBuildState',
      'getFileRevisions',
      'getPreferences',
      'getProjectConfig',
      'getRecentProjects',
      'importSettings',
      'openInCode',
      'openRecentProject',
      'openSetupLink',
      'readFile',
      'readPdf',
      'refreshProject',
      'renameEntry',
      'revealEntry',
      'saveFile',
      'setDirty',
      'setPreferences',
      'setProjectConfig',
      'setProjectPinned',
      'syncForward',
      'syncInverse',
      'testDistribution',
    ]);

    await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Project sidebar' })).toBeHidden();

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByRole('textbox', { name: 'Search commands' }).fill('bottom');
    await palette.getByRole('button', { name: 'Toggle bottom panel', exact: true }).click();
    await expect(palette).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Toggle bottom panel', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');

    await expect
      .poll(async () => {
        const result = await page.evaluate(() => window.textra.getPreferences());
        return result.ok ? result.value : undefined;
      })
      .toMatchObject({ theme: 'light', sidebarVisible: false, outputVisible: false });
    await application.close();
    application = await launch();
    const restored = await application.firstWindow();
    await expect(restored.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(
      restored.getByRole('button', { name: 'Toggle sidebar', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(
      restored.getByRole('button', { name: 'Toggle bottom panel', exact: true }),
    ).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
