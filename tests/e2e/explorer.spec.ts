import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('explorer expands folders on demand and pages through a large folder', async () => {
  test.setTimeout(90000);
  const parent = join(process.cwd(), 'test-results', 'incremental-explorer');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const root = join(directory, 'project');
  const userData = join(directory, 'profile');
  await mkdir(join(root, 'chapters', 'deep'), { recursive: true });
  await mkdir(userData);
  await writeFile(
    join(root, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}Root content.\\end{document}',
  );
  await writeFile(join(root, 'chapters', 'deep', 'one.tex'), 'Deep chapter content.');
  for (let start = 0; start < 502; start += 100)
    await Promise.all(
      Array.from({ length: Math.min(100, 502 - start) }, (_, index) =>
        writeFile(
          join(root, 'chapters', `entry-${String(start + index).padStart(4, '0')}.txt`),
          'Entry',
        ),
      ),
    );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env });
    await application.evaluate(({ dialog, shell }, projectRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [projectRoot] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      // Mock only Trash for disposable fixture files; keep validation, IPC and listing updates real.
      const fs = process.getBuiltinModule('fs') as typeof import('node:fs');
      const path = process.getBuiltinModule('path') as typeof import('node:path');
      shell.trashItem = async (filename) => {
        const target = path.resolve(filename);
        const relative = path.relative(path.resolve(projectRoot), target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
          throw new Error('Fixture deletion must stay in the disposable project.');
        await fs.promises.rm(target, { recursive: true });
      };
    }, root);
    const page = await application.firstWindow();
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await expect(page.getByTestId('source-editor')).toContainText('Root content.');
    const folder = page.getByRole('button', { name: 'Select folder chapters', exact: true });
    await expect(folder).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.file-entry[data-path^="chapters/"]')).toHaveCount(0);
    await folder.click();
    const more = page.getByRole('button', { name: 'Load more in chapters', exact: true });
    await expect(more).toBeVisible();
    await expect(page.locator('.file-entry[data-path^="chapters/"]')).toHaveCount(500);
    await more.click();
    await expect(page.locator('.file-entry[data-path^="chapters/"]')).toHaveCount(503);
    await expect(more).toHaveCount(0);
    const tree = page.locator('.file-tree');
    for (const number of [400, 401]) {
      const filename = `chapters/entry-${String(number).padStart(4, '0')}.txt`;
      const entry = page.getByRole('button', { name: `Open ${filename}`, exact: true });
      await entry.scrollIntoViewIfNeeded();
      const before = await tree.evaluate((element) => element.scrollTop);
      expect(before).toBeGreaterThan(1000);
      await entry.click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      await expect(entry).toHaveCount(0);
      await expect
        .poll(() => tree.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(before - 60);
      await expect(page.locator('.file-entry[data-path^="chapters/"]')).toHaveCount(
        503 - (number - 399),
      );
      const listing = await tree.getAttribute('data-listing-id');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(tree).not.toHaveAttribute('data-listing-id', listing!);
      await expect
        .poll(() => tree.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(before - 60);
      await expect(page.locator('.file-entry[data-path^="chapters/"]')).toHaveCount(
        503 - (number - 399),
      );
    }
    await page.getByRole('button', { name: 'Select folder chapters/deep', exact: true }).click();
    await page.getByRole('button', { name: 'Open chapters/deep/one.tex', exact: true }).click();
    await expect(page.getByTestId('source-editor')).toContainText('Deep chapter content.');
    await folder.click();
    await expect(page.locator('.file-entry[data-path^="chapters/"]')).toHaveCount(0);
    await folder.click();
    await expect(
      page.getByRole('button', { name: 'Open chapters/deep/one.tex', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('The file list reached its limit.', { exact: false })).toHaveCount(
      0,
    );
  } finally {
    await application?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
