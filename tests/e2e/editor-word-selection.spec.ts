import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('native editor extends word selection cumulatively in both directions', async () => {
  test.setTimeout(90000);
  const parent = join(process.cwd(), 'test-results', 'word-selection');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const projectRoot = join(directory, 'project');
  const userData = join(directory, 'user-data');
  await mkdir(projectRoot);
  await mkdir(userData);
  await writeFile(join(projectRoot, 'main.tex'), 'alpha beta gamma');
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) environment[key] = value;
  environment.TEXTRA_USER_DATA_DIR = userData;
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NO_SANDBOX;
  delete environment.ELECTRON_CLI_ARGS;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env: environment });
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, projectRoot);
    const page = await application.firstWindow();
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'LaTeX source editor', exact: true });
    const status = page.getByRole('status', { name: 'Editor status', exact: true });
    await editor.focus();
    await page.keyboard.press('End');
    const modifier = process.platform === 'darwin' ? 'Alt' : 'Control';
    await page.keyboard.press(`${modifier}+Shift+ArrowLeft`);
    await expect(status).toContainText('5 chars selected');
    await page.keyboard.press(`${modifier}+Shift+ArrowLeft`);
    await expect(status).toContainText('10 chars selected');
    await page.keyboard.press(`${modifier}+Shift+ArrowLeft`);
    await expect(status).toContainText('16 chars selected');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(`${modifier}+Shift+ArrowRight`);
    await expect(status).toContainText('5 chars selected');
    await page.keyboard.press(`${modifier}+Shift+ArrowRight`);
    await expect(status).toContainText('10 chars selected');
    await page.keyboard.press(`${modifier}+Shift+ArrowRight`);
    await expect(status).toContainText('16 chars selected');
    await expect(page.locator('.source-editor .view-lines')).toContainText(/alpha\s*beta\s*gamma/);
  } finally {
    if (application) {
      await application
        .evaluate(({ app }) => {
          setImmediate(() => app.exit(0));
        })
        .catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
