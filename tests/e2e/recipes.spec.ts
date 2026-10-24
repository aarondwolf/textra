import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { ProjectConfig } from '../../src/shared/api';

test('project recipes round-trip through builder, JSON and external settings edits', async () => {
  test.setTimeout(150000);
  const parent = join(process.cwd(), '.test-data', 'recipe-workflow');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const projectRoot = join(directory, 'résumé project');
  const userData = join(directory, 'user-data');
  await mkdir(projectRoot);
  await mkdir(userData);
  await writeFile(
    join(projectRoot, 'test.tex'),
    '\\documentclass{article}\n\\begin{document}\nRecipe test.\n\\end{document}\n',
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env });
    const page = await application.firstWindow();
    await application.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, projectRoot);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open test.tex', exact: true }).click();
    await page.keyboard.press('Escape');
    const filename = join(projectRoot, '.textra', 'settings.json');
    await expect.poll(() => readFile(filename, 'utf8')).toContain('latex-workshop.latex.recipes');
    const tools = await page.evaluate(() => window.textra.detectTools());
    test.skip(
      !tools.ok || !tools.value.some((tool) => tool.name === 'pdflatex' && tool.path),
      'A real pdfLaTeX installation is needed for recipe compilation.',
    );
    async function openRecipes() {
      await page.getByRole('button', { name: 'Choose compile recipe', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Manage recipes…', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await settings
        .getByRole('button', { name: 'Advanced project settings…', exact: true })
        .click();
      await expect(page.getByRole('dialog', { name: 'Build recipes', exact: true })).toBeVisible();
    }
    const dialog = page.getByRole('dialog', { name: 'Build recipes', exact: true });
    async function closeSettings() {
      await page
        .getByRole('dialog', { name: 'Settings', exact: true })
        .getByRole('button', { name: 'Close settings', exact: true })
        .click();
    }
    await openRecipes();
    await dialog.getByRole('button', { name: 'New recipe', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Recipe name', exact: true }).fill('Draft proof');
    await dialog.getByRole('button', { name: 'Add step', exact: true }).click();
    await page
      .getByRole('menu', { name: 'Add step', exact: true })
      .getByRole('menuitemradio', { name: 'pdflatex', exact: true })
      .click();
    await dialog.getByRole('button', { name: 'Edit tool pdflatex', exact: true }).first().click();
    const synctex = dialog.getByRole('button', { name: /^SyncTeX/ });
    await synctex.click();
    await expect(synctex).toHaveAttribute('aria-pressed', 'false');
    await synctex.click();
    await expect(synctex).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: /All recipes/ }).click();
    await expect(
      dialog.getByRole('button', { name: 'Edit recipe Draft proof', exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole('textbox', { name: 'Build folder', exact: true })
      .fill('build/custom output');
    await dialog.getByRole('button', { name: 'Project default recipe', exact: true }).click();
    await page
      .getByRole('menu', { name: 'Project default recipe', exact: true })
      .getByRole('menuitemradio', { name: 'Draft proof', exact: true })
      .click();
    await dialog.locator('.recipe-scroll').evaluate((element) => {
      element.scrollTop = 0;
    });
    await dialog.screenshot({ path: test.info().outputPath('recipe-builder.png') });
    await dialog.getByRole('button', { name: 'Save project settings', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
    await closeSettings();
    let saved = JSON.parse(await readFile(filename, 'utf8')) as ProjectConfig;
    expect(saved['latex-workshop.latex.recipes']).toContainEqual({
      name: 'Draft proof',
      tools: ['pdflatex', 'pdflatex'],
    });
    async function compileTo(fragment: string) {
      const previous = await page.evaluate(() => window.textra.getBuildState());
      expect(previous.ok).toBe(true);
      const previousVersion = previous.ok ? (previous.value.pdfVersion ?? 0) : 0;
      await page.getByRole('button', { name: 'Compile active document', exact: true }).click();
      await expect
        .poll(
          async () => {
            const result = await page.evaluate(() => window.textra.getBuildState());
            return result.ok &&
              !result.value.running &&
              result.value.outcome === 'success' &&
              (result.value.pdfVersion ?? 0) > previousVersion
              ? result.value.pdfPath
              : null;
          },
          { timeout: 45000 },
        )
        .toContain(fragment);
      await expect(
        page.getByRole('button', { name: 'Compile active document', exact: true }),
      ).toBeEnabled({ timeout: 45000 });
    }
    await compileTo('build/custom output/');
    await expect(page.locator('.pdf-scroll canvas')).toBeVisible({ timeout: 15000 });

    await openRecipes();
    await dialog.getByRole('button', { name: 'Edit settings.json directly', exact: true }).click();
    saved = JSON.parse(await readFile(filename, 'utf8')) as ProjectConfig;
    saved['latex-workshop.latex.outDir'] = 'build/from-json';
    await dialog
      .getByRole('textbox', { name: 'Project settings JSON', exact: true })
      .fill(JSON.stringify(saved, null, 2));
    await dialog.getByRole('button', { name: 'Save project settings', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
    await closeSettings();
    await compileTo('build/from-json/');

    // Direct disk edits are read afresh before the next compile, including JSONC.
    saved = JSON.parse(await readFile(filename, 'utf8')) as ProjectConfig;
    saved['latex-workshop.latex.outDir'] = 'build/external';
    await writeFile(filename, '// Edited outside TeXtra\n' + JSON.stringify(saved, null, 2));
    await compileTo('build/external/');

    // Recompiling to the same output filename must reload PDF bytes in the viewer.
    const before = await page.evaluate(() => window.textra.getBuildState());
    const canvas = page.locator('.pdf-scroll canvas');
    const renderedPdfFingerprint = () =>
      canvas.evaluate(async (element: HTMLCanvasElement) => {
        const image = new TextEncoder().encode(element.toDataURL());
        const digest = await crypto.subtle.digest('SHA-256', image);
        return Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
      });
    const previousPixels = await renderedPdfFingerprint();
    const editor = page.getByRole('textbox', { name: 'LaTeX source editor', exact: true });
    await editor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await page.keyboard.insertText(
      '\\documentclass{article}\n\\begin{document}\nChanged recipe text.\n\\end{document}\n',
    );
    await compileTo('build/external/');
    const after = await page.evaluate(() => window.textra.getBuildState());
    expect(
      before.ok && after.ok && (after.value.pdfVersion ?? 0) > (before.value.pdfVersion ?? 0),
    ).toBe(true);
    // Main's completed build precedes PDF.js loading/rendering its new bytes.
    await expect
      .poll(renderedPdfFingerprint, {
        timeout: 15000,
      })
      .not.toBe(previousPixels);
    await canvas.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
    await page
      .getByRole('textbox', { name: 'Search PDF', exact: true })
      .fill('Changed recipe text');
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page.locator('.pdf-search [role="status"]')).toContainText('Pages: 1');
    await page.keyboard.press('Escape');

    // A popup opened before an external edit cannot overwrite the newer settings.
    await openRecipes();
    saved = JSON.parse(
      (await readFile(filename, 'utf8')).replace(/^\/\/.*\n/, ''),
    ) as ProjectConfig;
    saved['latex-workshop.latex.outDir'] = 'build/newer-external';
    const external = JSON.stringify(saved, null, 2);
    await writeFile(filename, external);
    await dialog
      .getByRole('textbox', { name: 'Build folder', exact: true })
      .fill('build/stale-popup');
    await dialog.getByRole('button', { name: 'Save project settings', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('changed');
    expect(await readFile(filename, 'utf8')).toBe(external);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await closeSettings();
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
