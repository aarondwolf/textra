import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('approved formatting stays undoable and history restore preserves dirty text without a false external conflict', async () => {
  test.setTimeout(120000);
  const parent = join(process.cwd(), 'test-results', 'document-sessions');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const projectRoot = join(directory, 'project');
  const userData = join(directory, 'user-data');
  await mkdir(projectRoot);
  await mkdir(userData);
  const original =
    '\\documentclass{article}\n\\begin{document}\nOriginal content.\n\\end{document}\n';
  const formatted = original.replace('Original content.', 'Formatted content.');
  const filename = join(projectRoot, 'main.tex');
  await writeFile(filename, original);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  const mainErrors: string[] = [];
  try {
    application = await electron.launch({ args: ['.'], env });
    application.process().stderr?.on('data', (data: Buffer) => mainErrors.push(data.toString()));
    const page = await application.firstWindow();
    // Native editor/file IO remain real; only the optional external formatter is mocked.
    await application.evaluate(
      ({ dialog, ipcMain }, fixture) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture.projectRoot] });
        ipcMain.removeHandler('textra:language:format');
        ipcMain.handle('textra:language:format', () => ({
          ok: true,
          value: { content: fixture.formatted },
        }));
      },
      { projectRoot, formatted },
    );
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    const editor = page.getByTestId('source-editor');
    await expect(editor).toContainText('Original content.');
    await page.getByRole('button', { name: 'History & Projects', exact: true }).click();
    await page.getByRole('button', { name: 'Create snapshot now', exact: true }).click();
    const snapshotLabel = page.getByPlaceholder('Snapshot label (optional, e.g. Pre-Submission)');
    await snapshotLabel.fill('Original baseline');
    await snapshotLabel.press('Enter');
    const originalSnapshot = page
      .locator('.history-item')
      .filter({ hasText: 'Original baseline' })
      .first();
    await expect(originalSnapshot).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('textra:format-document')));
    const preview = page.getByRole('dialog', { name: 'Format preview', exact: true });
    await expect(preview).toContainText('Formatted content.');
    await preview.getByRole('button', { name: 'Apply formatted text', exact: true }).click();
    await expect(editor).toContainText('Formatted content.');
    await editor.click();
    await page.keyboard.press('Control+z');
    await expect(editor).toContainText('Original content.');
    await page.keyboard.press('Control+y');
    await expect(editor).toContainText('Formatted content.');
    const input = page.getByRole('textbox', { name: 'LaTeX source editor', exact: true });
    await expect(input).toHaveAttribute('aria-autocomplete', 'both');
    await input.focus();
    await page.keyboard.press('Control+End');
    await page.waitForTimeout(100);
    await page.keyboard.type('\n% New writing');
    await expect(editor).toContainText('% New writing');
    const save = page.getByRole('button', { name: 'Save file', exact: true });
    await expect(save).toBeEnabled();
    await page.keyboard.press('Control+s');
    try {
      await expect
        .poll(() => readFile(filename, 'utf8'), { timeout: 15000 })
        .toContain('Formatted content.');
    } catch (error) {
      console.info('Native save failure state', {
        errors: await page.locator('.workspace-error').allTextContents(),
        saveEnabled: await save.isEnabled(),
        mainErrors: mainErrors.join('').slice(-4000),
      });
      throw error;
    }
    await expect.poll(() => readFile(filename, 'utf8')).toContain('% New writing');

    const savedText = await readFile(filename, 'utf8');
    const dirtySuffix = ' Dirty text must survive history restoration exactly.';
    // Disk publication precedes the save acknowledgement and its history snapshot.
    // Monaco's logical readOnly does not set the native textarea's readonly flag.
    await expect(input).toHaveAttribute('aria-autocomplete', 'both');
    await input.focus();
    await expect(input).toBeFocused();
    await page.keyboard.press('Control+End');
    await page.waitForTimeout(100);
    await page.keyboard.type(dirtySuffix, { delay: 20 });
    await expect(editor).toContainText('Dirty text must survive history restoration exactly.');
    await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeEnabled();
    const dirtyText = savedText + dirtySuffix;
    // Use the ordinary snapshot actions and renderer confirmation; all history storage is real.
    const narrowActions = originalSnapshot.getByRole('button', {
      name: 'Snapshot actions',
      exact: true,
    });
    const hasNarrowActions = (await narrowActions.count()) > 0;
    if (hasNarrowActions) await narrowActions.click();
    page.once('dialog', (dialog) => void dialog.accept());
    if (hasNarrowActions) {
      await page.getByRole('menuitem', { name: 'Restore version', exact: true }).click();
    } else {
      await originalSnapshot.getByRole('button', { name: 'Restore snapshot', exact: true }).click();
    }
    await expect.poll(() => readFile(filename, 'utf8')).toBe(original);
    await expect(editor).toContainText('Original content.');
    await expect(editor).not.toContainText('Dirty text must survive');
    const historyRoot = join(projectRoot, '.textra', 'history');
    const index = JSON.parse(await readFile(join(historyRoot, 'index.json'), 'utf8')) as {
      snapshots: { id: string; path: string; label: string | null }[];
    };
    const editorBackup = index.snapshots.find(
      (snapshot) => snapshot.label === 'Pre-restore editor backup',
    );
    const diskBackup = index.snapshots.find(
      (snapshot) => snapshot.label === 'Pre-restore disk backup',
    );
    expect(editorBackup).toBeDefined();
    expect(diskBackup).toBeDefined();
    expect(
      gunzipSync(
        await readFile(join(historyRoot, `${editorBackup!.path}.${editorBackup!.id}.gz`)),
      ).toString('utf8'),
    ).toBe(dirtyText);
    expect(
      gunzipSync(
        await readFile(join(historyRoot, `${diskBackup!.path}.${diskBackup!.id}.gz`)),
      ).toString('utf8'),
    ).toBe(savedText);
    // Cross two real watcher samples; TeXtra's own restore must remain a local save.
    await page.waitForTimeout(2500);
    await expect(
      page.getByRole('dialog', { name: 'External change detected', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Resolve conflict', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: 'Save file', exact: true })).toBeDisabled();
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
