import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('editor scrollbars and the adjacent split handle can each be dragged', async () => {
  test.setTimeout(90000);
  const parent = join(process.cwd(), 'test-results', 'editor-scrollbar');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const project = join(directory, 'project');
  const profile = join(directory, 'profile');
  await Promise.all([mkdir(project), mkdir(profile)]);
  await writeFile(
    join(project, 'main.tex'),
    Array.from({ length: 120 }, (_, index) => `Paragraph ${index} with some prose.\n\n`).join(''),
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = profile;
  delete env.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env });
    const page = await application.firstWindow();
    await application.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
    }, project);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await page.getByRole('radio', { name: 'Visual', exact: true }).click();
    const surface = page.getByTestId('visual-editor');
    await expect(surface).toBeVisible();
    const split = page.getByRole('separator', { name: 'Editor and preview split' });
    const widthBefore = await split.getAttribute('aria-valuenow');
    const box = await surface.boundingBox();
    if (!box) throw new Error('Visual editor has no bounds');
    const x = box.x + box.width - 3;
    const y = box.y + 10;
    expect(
      await page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.split-handle')),
        { x, y },
      ),
    ).toBe(false);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 120, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => surface.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(split).toHaveAttribute('aria-valuenow', widthBefore!);

    await page.getByRole('radio', { name: 'Code', exact: true }).click();
    const source = page.getByTestId('source-editor');
    const thumb = source.locator('.scrollbar.vertical .slider').first();
    await expect(thumb).toBeVisible();
    const thumbBox = await thumb.boundingBox();
    if (!thumbBox) throw new Error('Monaco scrollbar has no bounds');
    const thumbX = thumbBox.x + thumbBox.width / 2;
    const thumbY = thumbBox.y + Math.min(thumbBox.height / 2, 10);
    expect(
      await page.evaluate(
        ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.split-handle')),
        { x: thumbX, y: thumbY },
      ),
    ).toBe(false);
    await page.mouse.move(thumbX, thumbY);
    await page.mouse.down();
    await page.mouse.move(thumbX, thumbY + 120, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() => thumb.evaluate((element) => Number.parseFloat(element.style.top || '0')))
      .toBeGreaterThan(0);
    await expect(split).toHaveAttribute('aria-valuenow', widthBefore!);

    const splitBox = await split.boundingBox();
    if (!splitBox) throw new Error('Split handle has no bounds');
    await page.mouse.move(splitBox.x + splitBox.width / 2, splitBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(splitBox.x + splitBox.width / 2 + 40, splitBox.y + 80, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(async () => Number(await split.getAttribute('aria-valuenow')))
      .toBeGreaterThan(Number(widthBefore));
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
