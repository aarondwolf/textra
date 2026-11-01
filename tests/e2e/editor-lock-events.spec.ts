import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('editor insertion and formatting events respect external conflict locks', async () => {
  test.setTimeout(90000);
  const parent = join(process.cwd(), 'test-results', 'editor-lock-events');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const root = join(directory, 'project');
  const userData = join(directory, 'profile');
  await mkdir(root);
  await mkdir(userData);
  const file = join(root, 'main.tex');
  const original = '\\documentclass{article}\n\\begin{document}\nOriginal text.\n\\end{document}\n';
  await writeFile(file, original);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env });
    const page = await application.firstWindow();
    await application.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
    }, root);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    const editor = page.getByTestId('source-editor');
    await expect(editor).toContainText('Original text.');
    const emit = () =>
      page.evaluate(() => {
        const insert = new CustomEvent('textra:insert-source', {
          cancelable: true,
          detail: { text: '\\alpha', caret: 6 },
        });
        const format = new CustomEvent('textra:format-source', {
          cancelable: true,
          detail: { command: 'bold' },
        });
        window.dispatchEvent(insert);
        window.dispatchEvent(format);
        return { inserted: insert.defaultPrevented, formatted: format.defaultPrevented };
      });
    expect(await emit()).toEqual({ inserted: true, formatted: true });
    await expect(editor).toContainText('alpha');
    await writeFile(file, original + '% External update\n');
    await expect(page.locator('.conflict-banner')).toBeVisible({ timeout: 15000 });
    const before = await editor.textContent();
    expect(await emit()).toEqual({ inserted: false, formatted: false });
    expect(await editor.textContent()).toBe(before);
    expect(await readFile(file, 'utf8')).toBe(original + '% External update\n');
  } finally {
    await application
      ?.evaluate(({ app }) => {
        setImmediate(() => app.exit(0));
      })
      .catch(() => undefined);
    await application?.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
