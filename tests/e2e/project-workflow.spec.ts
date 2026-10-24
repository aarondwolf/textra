import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  await writeFile(
    join(userData, 'preferences.json'),
    JSON.stringify({
      version: 1,
      theme: 'dark',
      sidebarVisible: true,
      outputVisible: false,
      editorWidth: 55,
    }),
  );
  await cp(join(process.cwd(), 'tests', 'fixtures', 'dissertation'), projectRoot, {
    recursive: true,
  });
  expect(await readdir(projectRoot)).toContain('main.tex');
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  environment.TEXTRA_USER_DATA_DIR = userData;
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NO_SANDBOX;
  delete environment.ELECTRON_CLI_ARGS;
  let application: ElectronApplication | undefined;
  const mainErrors: string[] = [];
  const rendererErrors: string[] = [];
  try {
    application = await electron.launch({ args: ['.'], env: environment });
    application.process().stderr?.on('data', (data: Buffer) => mainErrors.push(data.toString()));
    const page = await application.firstWindow();
    page.on('pageerror', (error) => rendererErrors.push(error.message));
    await expect(
      page.getByRole('button', { name: 'Compile active document', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Compile active document', exact: true }),
    ).toHaveAttribute('title', 'Open a .tex document to compile it.');
    // The native file chooser is the only mocked integration. Files, Monaco,
    // IPC, compiler, SyncTeX, and PDF rendering use their real implementations.
    await application.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
    }, projectRoot);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    // Folders start collapsed, so nested files stay hidden until the folder is opened.
    await expect(
      page.getByRole('button', { name: 'Select folder chapters', exact: true }),
    ).toHaveAttribute('aria-expanded', 'false');
    await expect(
      page.getByRole('button', { name: 'Open chapters/introduction.tex', exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(async () => ({
        mainPresent:
          (await page.getByRole('button', { name: 'Open main.tex', exact: true }).count()) === 1,
        fileLabels: await page
          .locator('.file-entry')
          .evaluateAll((entries) => entries.map((entry) => entry.getAttribute('aria-label'))),
        errors: await page.locator('.workspace-error').allTextContents(),
      }))
      .toMatchObject({ mainPresent: true });
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await expect(page.locator('.file-actions')).toHaveCount(0);
    await expect
      .poll(async () => (await page.locator('.source-editor').boundingBox())?.height ?? 0)
      .toBeGreaterThan(200);
    await expect(page.locator('.monaco-editor .codicon-folding-expanded').first()).toBeAttached({
      timeout: 30_000,
    });
    const fileActions = page.getByRole('menu', { name: 'Actions for main.tex', exact: true });
    // Selecting a file must not open its menu; it opens on right click or the ... button.
    await expect(fileActions).toHaveCount(0);
    await page.getByRole('button', { name: 'More actions for main.tex', exact: true }).click();
    await expect(fileActions).toBeVisible();
    for (const name of ['Rename', 'Delete', 'Open in File Explorer', 'Open in VS Code']) {
      await expect(fileActions.getByRole('menuitem', { name, exact: true })).toBeVisible();
    }
    await fileActions.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const renameDialog = page.getByRole('dialog', { name: 'Rename entry', exact: true });
    await expect(renameDialog.getByRole('textbox', { name: 'Path', exact: true })).toHaveValue(
      'main.tex',
    );
    await renameDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const controls = [
      page.getByRole('button', { name: 'Compile active document', exact: true }),
      page.getByRole('tab', { name: 'Preview', exact: true }),
      page.getByRole('tab', { name: 'Problems', exact: true }),
      page.getByRole('tab', { name: 'Output', exact: true }),
    ];
    const centers = await Promise.all(
      controls.map(async (control) => {
        const bounds = (await control.boundingBox())!;
        return bounds.y + bounds.height / 2;
      }),
    );
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
    // The application titlebar owns visibility; the collapsed rail restores the preview.
    const previewToggle = page.getByRole('button', { name: 'Toggle preview', exact: true });
    await expect(previewToggle).toHaveAttribute('aria-pressed', 'true');
    await previewToggle.click();
    await expect(page.getByRole('region', { name: 'Preview pane', exact: true })).toBeHidden();
    await expect(previewToggle).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Show PDF preview', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Preview pane', exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Compile active document', exact: true }),
    ).toBeEnabled();
    const editor = page.getByRole('textbox', { name: 'LaTeX source editor' });
    await expect(editor).toBeVisible();
    await editor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.insertText('\n% Saved from the native Monaco editor.\n');
    await expect(page.locator('.source-editor')).toContainText(
      'Saved from the native Monaco editor.',
    );
    const save = page.getByRole('button', { name: 'Save file', exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect
      .poll(
        async () => ({
          disk: await readFile(join(projectRoot, 'main.tex'), 'utf8'),
          errors: await page.locator('.workspace-error').allTextContents(),
          saveEnabled: await save.isEnabled(),
          editorReadOnly: await editor.getAttribute('aria-readonly'),
          activeTabs: await page.getByRole('tab', { selected: true }).allTextContents(),
          mainErrors: mainErrors.join('').slice(-4000),
          rendererErrors,
        }),
        { timeout: 15000 },
      )
      .toMatchObject({ disk: expect.stringContaining('Saved from the native Monaco editor.') });

    await editor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.insertText('% Unsaved buffer must survive an external change.\n');
    const externalContent =
      (await readFile(join(projectRoot, 'main.tex'), 'utf8')) + '% External writer content.\n';
    await writeFile(join(projectRoot, 'main.tex'), externalContent, 'utf8');
    const conflict = page.getByRole('dialog', { name: 'External change detected', exact: true });
    await expect(conflict).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByRole('button', { name: 'Save file', exact: true, includeHidden: true }),
    ).toBeDisabled();
    expect(await readFile(join(projectRoot, 'main.tex'), 'utf8')).toBe(externalContent);
    await expect(conflict.getByRole('status')).toContainText('external file appears stable', {
      timeout: 10000,
    });
    await conflict.getByRole('button', { name: 'Save conflicted copy', exact: true }).click();
    await expect(conflict).toBeHidden();
    const isPreservedCopy = (name: string) => /^main\.CONFLICTED_.*\.tex$/.test(name);
    await expect
      .poll(async () => (await readdir(projectRoot)).filter(isPreservedCopy))
      .toHaveLength(1);
    const preservedPath = (await readdir(projectRoot)).find(isPreservedCopy)!;
    const preservedContent = await readFile(join(projectRoot, preservedPath), 'utf8');
    expect(preservedContent).toContain('Unsaved buffer must survive an external change.');
    expect(preservedContent).not.toContain('External writer content.');
    expect(await readFile(join(projectRoot, 'main.tex'), 'utf8')).toBe(externalContent);

    // Resolving the original closes only its protected buffer; reopening reads the external version.
    await page.getByRole('tab', { name: 'Edit main.tex', exact: true }).click();
    await page.getByRole('button', { name: 'Resolve conflict', exact: true }).click();
    await conflict.getByRole('button', { name: 'Discard and close tab', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Edit main.tex', exact: true })).toHaveCount(0);
    expect(await readFile(join(projectRoot, 'main.tex'), 'utf8')).toBe(externalContent);
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await expect(page.locator('.conflict-banner')).toHaveCount(0);
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
    await expect(page.getByRole('combobox', { name: 'Root document', exact: true })).toHaveCount(0);
    await expect(page.locator('.build-toolbar')).toHaveCount(0);
    await page.getByRole('button', { name: 'Choose compile recipe', exact: true }).click();
    await page.getByRole('button', { name: 'pdfLaTeX + BibTeX', exact: true }).click();
    await page.getByRole('button', { name: 'Compile active document', exact: true }).click();
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
    const pdfControls = page.getByRole('button', { name: 'PDF controls', exact: true });
    if (await pdfControls.isVisible()) await pdfControls.click();
    await page.getByRole('button', { name: 'Next PDF page', exact: true }).click();
    if (await pdfControls.isVisible()) await page.keyboard.press('Escape');
    await expect(page.locator('canvas[aria-label="PDF page 2"]')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Preview', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('textbox', { name: 'Search PDF', exact: true })).toBeHidden();
    await page.locator('canvas[aria-label="PDF page 2"]').focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
    await page.getByRole('textbox', { name: 'Search PDF', exact: true }).fill('Introduction');
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.locator('.pdf-search [role="status"]')).toContainText('Pages:');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Search PDF', exact: true })).toBeHidden();
    await page.locator('canvas[aria-label="PDF page 2"]').focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+h' : 'Control+h');
    await expect(page.locator('.monaco-editor .find-widget.visible')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Output', exact: true }).click();
    await expect(page.getByLabel('Build output', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /Problems/ }).click();
    await expect(page.getByRole('tabpanel', { name: /Problems/ })).toBeVisible();
    await page.getByRole('tab', { name: 'Preview', exact: true }).click();
    const editorWidth = (await page
      .getByRole('region', { name: 'Editor', exact: true })
      .boundingBox())!.width;
    await previewToggle.click();
    await expect(page.getByRole('region', { name: 'Preview pane', exact: true })).toBeHidden();
    expect(
      (await page.getByRole('region', { name: 'Editor', exact: true }).boundingBox())!.width,
    ).toBeGreaterThan(editorWidth);
    await page.getByRole('button', { name: 'Show PDF preview', exact: true }).click();
    await expect(page.locator('canvas[aria-label="PDF page 2"]')).toBeVisible();
    await page.screenshot({ path: join(testRoot, 'native-project-workflow.png') });

    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    expect(
      JSON.parse(await readFile(join(projectRoot, '.textra', 'settings.json'), 'utf8')),
    ).toMatchObject({ schemaVersion: 1, recipes: { 'main.tex': 'bibtex-pipeline' } });
    await settings.getByRole('button', { name: 'Compilation', exact: true }).click();
    await settings
      .getByRole('button', { name: 'Default recipe for new documents', exact: true })
      .click();
    await settings.getByRole('menuitem', { name: 'XeLaTeX', exact: true }).click();
    const exportFile = join(directory, 'settings.json');
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, exportFile);
    await settings.getByRole('button', { name: 'Import & export', exact: true }).click();
    await settings.getByRole('button', { name: 'Export settings', exact: true }).click();
    await expect(settings.locator('.setup-message')).toContainText('Settings exported');
    expect(JSON.parse(await readFile(exportFile, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      preferences: { theme: 'dark', defaultRecipe: 'xelatex' },
    });
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    await settings.getByRole('button', { name: 'Appearance', exact: true }).click();
    await settings.getByRole('button', { name: 'Theme', exact: true }).click();
    await settings.getByRole('menuitem', { name: 'Light', exact: true }).click();
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }, exportFile);
    await settings.getByRole('button', { name: 'Import & export', exact: true }).click();
    await settings.getByRole('button', { name: 'Import settings', exact: true }).click();
    await expect(settings.locator('.setup-message')).toContainText('Theme and layout imported');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await application.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, projectRoot);
    await settings.getByRole('button', { name: 'LaTeX tools', exact: true }).click();
    await settings.getByRole('button', { name: 'Test TeX installation', exact: true }).click();
    await expect(settings.locator('.setup-message')).toContainText(
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
    await page.getByRole('button', { name: 'Choose compile recipe', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'pdfLaTeX + BibTeX', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open ' + preservedPath, exact: true }).click();
    await page.getByRole('button', { name: 'Choose compile recipe', exact: true }).click();
    await expect(page.getByRole('button', { name: 'XeLaTeX', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: 'pdfLaTeX', exact: true }).click();
    await page.getByRole('button', { name: 'Compile active document', exact: true }).click();
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(() => window.textra.getBuildState());
          return result.ok && !result.value.running ? result.value.rootFile : null;
        },
        { timeout: 60000 },
      )
      .toBe(preservedPath);
    expect(
      JSON.parse(await readFile(join(projectRoot, '.textra', 'settings.json'), 'utf8')).recipes,
    ).toEqual({
      'main.tex': 'bibtex-pipeline',
      [preservedPath]: 'pdflatex',
    });
    await page.getByRole('tab', { name: 'Output', exact: true }).click();
    // A rejected recipe change keeps the previous saved recipe usable for compilation.
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('textra:config:set');
      ipcMain.handle('textra:config:set', () => ({ ok: false, error: 'Settings are read-only.' }));
    });
    await page.getByRole('tab', { name: 'Edit main.tex', exact: true }).click();
    await page.getByRole('button', { name: 'Choose compile recipe', exact: true }).click();
    await page.getByRole('button', { name: 'pdfLaTeX', exact: true }).click();
    await expect(page.locator('.workspace-error')).toContainText('Settings are read-only.');
    await page.getByRole('button', { name: 'Compile active document', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Output', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(() => window.textra.getBuildState());
          return result.ok && !result.value.running ? result.value.rootFile : null;
        },
        { timeout: 60000 },
      )
      .toBe('main.tex');
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
