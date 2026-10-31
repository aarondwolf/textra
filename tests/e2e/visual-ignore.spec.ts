import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('visual ignore settings update the active projection and preserve source', async () => {
  test.setTimeout(120000);
  const parent = join(process.cwd(), 'test-results', 'visual-ignore');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const root = join(directory, 'project');
  const userData = join(directory, 'profile');
  await mkdir(root);
  await mkdir(userData);
  const original = [
    '\\documentclass{article}',
    '\\begin{document}',
    '% Standalone comment must remain in source.',
    'Before \\clearpage{} after.',
    '',
    '\\begin{landscape}',
    'Landscape text.',
    '\\end{landscape}',
    '',
    'Before \\customhide after.',
    '',
    '\\begin{customwrap}',
    'Custom environment text.',
    '\\end{customwrap}',
    '\\end{document}',
    '',
  ].join('\n');
  const file = join(root, 'main.tex');
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
    await page.getByRole('radio', { name: 'Visual', exact: true }).click();
    const visual = page.getByRole('textbox', { name: 'Visual LaTeX editor', exact: true });
    await expect(visual).toBeVisible();
    await expect(visual).toContainText('Landscape text.');
    await expect(visual.getByText('Standalone comment must remain in source.')).toHaveCount(0);
    await expect(visual.locator('[data-visual-ignored="true"]')).toHaveCount(2);
    await expect(visual.getByRole('button', { name: 'Edit source: customwrap' })).toBeVisible();
    expect(await readFile(file, 'utf8')).toBe(original);

    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    const commands = page.getByRole('textbox', { name: 'Ignored visual commands', exact: true });
    const environments = page.getByRole('textbox', {
      name: 'Ignored visual environments',
      exact: true,
    });
    await expect(commands).toHaveValue(/clearpage/);
    await expect(environments).toHaveValue(/landscape/);
    await commands.fill('customhide');
    await environments.fill('customwrap');
    await page.getByRole('button', { name: 'Apply visual ignore settings', exact: true }).click();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();

    await expect(visual).toContainText('Custom environment text.');
    await expect(visual).not.toContainText('Landscape text.');
    await expect(visual.getByText('Standalone comment must remain in source.')).toHaveCount(0);
    await expect(visual.locator('[data-visual-ignored="true"]')).toHaveCount(2);
    expect(await readFile(file, 'utf8')).toBe(original);

    const paragraph = visual.locator('p').filter({ hasText: 'Custom environment text.' });
    await paragraph.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' edited');
    await expect(paragraph).toContainText('Custom environment text. edited');

    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    await page.getByRole('button', { name: 'Reset visual ignore settings', exact: true }).click();
    await expect(commands).toHaveValue(/clearpage/);
    await expect(environments).toHaveValue(/landscape/);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect(visual).toContainText('Landscape text.');
    await expect(visual).not.toContainText('Custom environment text.');
    await page.getByRole('radio', { name: 'Code', exact: true }).click();
    await expect(page.getByTestId('source-editor')).toContainText(
      'Custom environment text. edited',
    );
    await page.keyboard.press('Control+s');
    const expected = original.replace(
      'Custom environment text.',
      'Custom environment text. edited',
    );
    await expect.poll(() => readFile(file, 'utf8'), { timeout: 15000 }).toBe(expected);
    expect(expected).toContain('% Standalone comment must remain in source.');
    expect(expected).toContain('\\begin{customwrap}');
    expect(expected).toContain('\\end{customwrap}');
    expect(expected).toContain('\\clearpage{}');
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
