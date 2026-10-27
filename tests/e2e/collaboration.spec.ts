import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

async function openSharedProject(
  page: Page,
  app: ElectronApplication,
  root: string,
): Promise<void> {
  await app.evaluate(({ dialog }, selectedRoot) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
  }, root);
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open main.tex', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
  await page.getByRole('button', { name: 'Collaboration', exact: true }).click();
  await page.getByRole('radio', { name: 'Background merge', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Background merge', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await page.getByRole('button', { name: 'Open other.tex', exact: true }).click();
  await expect(page.locator('.monaco-editor .view-lines')).toBeVisible();
  await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
  await expect(page.locator('.monaco-editor .view-lines')).toBeVisible();
  // Session creation loads Yjs and the binding asynchronously after Monaco paints.
  await page.waitForTimeout(1000);
}

async function typeAtEnd(page: Page, text: string): Promise<void> {
  const editor = page.locator('.monaco-editor').first();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(text);
}

test('two isolated profiles merge saved Yjs updates and preserve local typing', async () => {
  test.setTimeout(90000);
  const testRoot = await mkdtemp(join(tmpdir(), 'textra-collaboration-'));
  const projectRoot = join(testRoot, 'shared-project');
  const userDataA = join(testRoot, 'profile-a');
  const userDataB = join(testRoot, 'profile-b');
  await Promise.all([mkdir(projectRoot), mkdir(userDataA), mkdir(userDataB)]);
  const sourcePath = join(projectRoot, 'main.tex');
  await writeFile(
    sourcePath,
    '\\documentclass{article}\n\\begin{document}\nBase\n\\end{document}\n',
  );
  await writeFile(join(projectRoot, 'other.tex'), 'Other document\n');
  const environmentFor = (userData: string): Record<string, string> => {
    const environment: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    environment.TEXTRA_USER_DATA_DIR = userData;
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.NO_SANDBOX;
    delete environment.ELECTRON_CLI_ARGS;
    return environment;
  };
  let appA: ElectronApplication | undefined;
  let appB: ElectronApplication | undefined;
  try {
    appA = await electron.launch({ args: ['.'], env: environmentFor(userDataA) });
    const pageA = await appA.firstWindow();
    await openSharedProject(pageA, appA, projectRoot);
    await typeAtEnd(pageA, 'Peer A');
    await pageA.keyboard.press('Control+s');
    await expect
      .poll(async () => (await readFile(sourcePath, 'utf8')).includes('Peer A'))
      .toBe(true);
    const crdtDirectory = join(
      projectRoot,
      '.textra',
      'crdt',
      createHash('sha256').update('main.tex').digest('hex'),
    );
    await expect
      .poll(async () => {
        try {
          return (await readdir(crdtDirectory)).filter((name) => name.endsWith('.json')).length;
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
            return 0;
          throw error;
        }
      })
      .toBeGreaterThan(0);

    appB = await electron.launch({ args: ['.'], env: environmentFor(userDataB) });
    const pageB = await appB.firstWindow();
    await openSharedProject(pageB, appB, projectRoot);
    await typeAtEnd(pageB, 'Peer B');

    await typeAtEnd(pageA, 'Concurrent A');
    await pageA.keyboard.press('Control+s');
    await expect
      .poll(async () => (await readFile(sourcePath, 'utf8')).includes('Concurrent A'))
      .toBe(true);

    await expect
      .poll(async () => readFile(sourcePath, 'utf8'), { timeout: 30000 })
      .toContain('Peer B');
    const finalText = await readFile(sourcePath, 'utf8');
    expect(finalText).toContain('Concurrent A');
    expect(finalText).toContain('Peer B');
    await expect(pageB.locator('.workspace-error')).toHaveCount(0);

    await writeFile(sourcePath, `${finalText}% Plain external edit without a Yjs record.\n`);
    await expect(pageB.locator('.conflict-banner')).toBeVisible({ timeout: 15000 });
    await expect(pageB.getByRole('dialog', { name: 'External change detected' })).toHaveCount(0);
    await expect(pageB.getByRole('button', { name: 'Save file', exact: true })).toBeDisabled();
  } finally {
    await appB?.close().catch(() => undefined);
    await appA?.close().catch(() => undefined);
    await rm(testRoot, { recursive: true, force: true });
  }
});
