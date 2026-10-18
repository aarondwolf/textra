import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('real project editing preserves external changes, compiles, and renders a PDF', async () => {
  test.setTimeout(120000);
  const testRoot = join(process.cwd(), '.test-data', 'native-workflow');
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'case-'));
  const projectRoot = join(directory, 'résumé project with spaces');
  const userData = join(directory, 'user-data');
  await mkdir(userData);
  await cp(join(process.cwd(), 'tests', 'fixtures', 'dissertation'), projectRoot, {
    recursive: true,
  });
  const environment: Record<string, string> = { TEXTRA_USER_DATA_DIR: userData };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NO_SANDBOX;
  delete environment.ELECTRON_CLI_ARGS;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env: environment });
    const page = await application.firstWindow();
    // The native file chooser is the only mocked integration. Files, Monaco,
    // IPC, compiler, SyncTeX, and PDF rendering use their real implementations.
    await application.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
    }, projectRoot);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'LaTeX source editor' });
    await expect(editor).toBeVisible();
    await editor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.insertText('\n% Saved from the native Monaco editor.\n');
    await page.getByRole('button', { name: 'Save file', exact: true }).click();
    await expect
      .poll(() => readFile(join(projectRoot, 'main.tex'), 'utf8'))
      .toContain('Saved from the native Monaco editor.');

    await editor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.insertText('% Unsaved buffer must survive an external change.\n');
    const externalContent =
      (await readFile(join(projectRoot, 'main.tex'), 'utf8')) + '% External writer content.\n';
    await writeFile(join(projectRoot, 'main.tex'), externalContent, 'utf8');
    await expect(
      page.getByText('This file changed on disk. Your open text is preserved.', { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeDisabled();
    expect(await readFile(join(projectRoot, 'main.tex'), 'utf8')).toBe(externalContent);

    await page.getByRole('button', { name: 'Save file as', exact: true }).first().click();
    const saveCopy = page.getByRole('dialog', { name: 'Save file as', exact: true });
    await saveCopy.getByRole('textbox', { name: 'Path' }).fill('preserved-copy.tex');
    await saveCopy.getByRole('button', { name: 'Save copy', exact: true }).click();
    await expect
      .poll(() => readFile(join(projectRoot, 'preserved-copy.tex'), 'utf8'))
      .toContain('Unsaved buffer must survive an external change.');
    expect(await readFile(join(projectRoot, 'main.tex'), 'utf8')).toBe(externalContent);

    await page.getByRole('tab', { name: 'Edit main.tex', exact: true }).click();
    await page.getByRole('button', { name: 'Reload from disk', exact: true }).click();
    const reload = page.getByRole('dialog', { name: 'Reload from disk', exact: true });
    await reload.getByRole('button', { name: 'Discard edits and reload', exact: true }).click();
    await expect(
      page.getByText('This file changed on disk. Your open text is preserved.', { exact: true }),
    ).toBeHidden();
    await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeDisabled();

    const tools = await page.evaluate(() => window.textra.detectTools());
    expect(tools.ok).toBe(true);
    if (!tools.ok) throw new Error(tools.error);
    const canCompile = ['pdflatex', 'bibtex'].every((name) =>
      tools.value.some((tool) => tool.name === name && tool.path),
    );
    test.skip(
      !canCompile,
      'Real editing/conflict steps passed; pdflatex/BibTeX unavailable, native compile/PDF remains unverified.',
    );
    await page
      .getByRole('combobox', { name: 'Root document', exact: true })
      .selectOption('main.tex');
    await page
      .getByRole('combobox', { name: 'Compiler', exact: true })
      .selectOption('bibtex-pipeline');
    await page.getByRole('button', { name: 'Compile project', exact: true }).click();
    await expect
      .poll(
        async () => {
          const state = await page.evaluate(() => window.textra.getBuildState());
          return state.ok ? state.value.outcome : 'ipc-error';
        },
        { timeout: 60000 },
      )
      .toBe('success');
    const canvas = page.locator('canvas[aria-label="PDF page 1"]');
    await expect(canvas).toBeVisible({ timeout: 20000 });
    await expect
      .poll(() =>
        canvas.evaluate((element) => {
          if (!(element instanceof HTMLCanvasElement)) return false;
          const context = element.getContext('2d');
          if (!context || !element.width || !element.height) return false;
          const pixels = context.getImageData(0, 0, element.width, element.height).data;
          let dark = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              pixels[index + 3] > 0 &&
              pixels[index] < 150 &&
              pixels[index + 1] < 150 &&
              pixels[index + 2] < 150
            )
              dark++;
          }
          return dark > 100;
        }),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Next PDF page', exact: true }).click();
    await expect(page.locator('canvas[aria-label="PDF page 2"]')).toBeVisible();
    await page.getByRole('textbox', { name: 'Search PDF', exact: true }).fill('Introduction');
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.locator('.pdf-search [role="status"]')).toContainText('Pages:');
    await page.screenshot({ path: join(testRoot, 'native-project-workflow.png') });

    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings & TeX setup', exact: true });
    await settings.getByRole('button', { name: 'Save project preferences', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('Project preferences saved');
    expect(
      JSON.parse(await readFile(join(projectRoot, '.textra', 'project.json'), 'utf8')),
    ).toMatchObject({ schemaVersion: 1, rootFile: 'main.tex', engine: 'bibtex-pipeline' });
    const exportFile = join(directory, 'settings.json');
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, exportFile);
    await settings.getByRole('button', { name: 'Export settings', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('Settings exported');
    expect(JSON.parse(await readFile(exportFile, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      preferences: { theme: 'dark' },
    });
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }, exportFile);
    await settings.getByRole('button', { name: 'Import settings', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('Theme and layout imported');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, projectRoot);
    await settings.getByRole('button', { name: 'Test TeX installation', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText(
      'Test document compiled successfully',
      { timeout: 40000 },
    );
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();

    await editor.focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('% Discard only after explicit confirmation.\n');
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    const unsaved = page.getByRole('dialog', { name: 'Unsaved changes', exact: true });
    await unsaved.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await unsaved.getByRole('button', { name: 'Discard and continue', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: 'Compiler', exact: true })).toHaveValue(
      'bibtex-pipeline',
    );
    expect(await readFile(join(projectRoot, 'main.tex'), 'utf8')).not.toContain(
      'Discard only after',
    );
  } finally {
    if (application) {
      // On assertion failure a dirty temporary document may keep a native close
      // confirmation open. Exit only this isolated test application.
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
