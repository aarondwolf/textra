import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('narrow editor exposes formatting actions in an accessible overflow menu', async () => {
  test.setTimeout(90000);
  const parent = join(process.cwd(), '.test-data', 'editor-toolbar-overflow');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const root = join(directory, 'project');
  const userData = join(directory, 'profile');
  await mkdir(root);
  await mkdir(userData);
  await writeFile(join(root, 'main.tex'), '\\begin{document}\nA paragraph.\n\\end{document}\n');
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env });
    const page = await application.firstWindow();
    await application.evaluate(({ dialog, BrowserWindow }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
      BrowserWindow.getAllWindows()[0].setSize(1440, 940);
    }, root);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    const toolbar = page.locator('.editor-format-toolbar');
    const pane = page.locator('.editor-pane');
    const wrap = page.getByRole('button', { name: 'Toggle word wrap', exact: true });
    await expect(wrap).toBeVisible();
    await expect(wrap).toHaveAttribute('aria-pressed', 'false');
    const off = await wrap.evaluate((button) => getComputedStyle(button).backgroundColor);
    await wrap.click();
    await expect(wrap).toHaveAttribute('aria-pressed', 'true');
    const on = await wrap.evaluate((button) => getComputedStyle(button).backgroundColor);
    expect(on).not.toBe(off);
    const sizeControl = page.getByRole('button', { name: 'Editor font size', exact: true });
    const sizeBounds = await sizeControl.boundingBox();
    const wrapBounds = await wrap.boundingBox();
    expect(sizeBounds).not.toBeNull();
    expect(wrapBounds).not.toBeNull();
    expect(wrapBounds!.x).toBeGreaterThan(sizeBounds!.x + sizeBounds!.width);

    await pane.evaluate((element) => {
      element.style.width = '270px';
      element.style.flex = '0 0 270px';
    });
    const more = page.getByRole('button', { name: 'More formatting actions', exact: true });
    await expect(more).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Code', exact: true })).toBeVisible();
    await more.click();
    for (const label of [
      'Bold',
      'Italic',
      'Numbered list',
      'Bulleted list',
      'Insert figure',
      'Insert table',
      'Section',
      'Subsection',
      'Save file',
      'Save file as',
    ])
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /^14px/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Toggle word wrap/ })).toContainText('On');
    await page.getByRole('menuitem', { name: /Toggle word wrap/ }).click();
    await more.click();
    await expect(page.getByRole('menuitem', { name: /Toggle word wrap/ })).toContainText('Off');
    await page.keyboard.press('Escape');
    const editorInput = page.getByRole('textbox', { name: 'LaTeX source editor', exact: true });
    await editorInput.focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await more.click();
    await page.getByRole('menuitem', { name: 'Bold', exact: true }).click();
    await expect(page.getByTestId('source-editor')).toContainText('\\textbf{A paragraph.}');
    await editorInput.focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('source-editor')).not.toContainText('\\textbf{A paragraph.}');
    await pane.evaluate((element) => {
      element.style.width = '900px';
      element.style.flex = '0 0 900px';
    });
    await expect(more).toBeHidden();
    await expect(wrap).toBeVisible();
    await expect(wrap).toHaveAttribute('aria-pressed', 'false');
    expect(await toolbar.evaluate((element) => element.getBoundingClientRect().height)).toBe(29);
  } finally {
    await application?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
