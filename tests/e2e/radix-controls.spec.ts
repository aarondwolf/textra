import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('Radix menus remain visible, keyboard accessible, and aligned across workspace sizes', async () => {
  test.setTimeout(90000);
  const root = join(process.cwd(), '.test-data', 'radix-controls');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'case-'));
  const projectRoot = join(directory, 'project');
  const userData = join(directory, 'user-data');
  await mkdir(projectRoot);
  await mkdir(userData);
  await writeFile(
    join(projectRoot, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nUI audit fixture.\n\\end{document}\n',
  );
  await writeFile(
    join(projectRoot, 'notes.md'),
    '# Markdown audit fixture\nMarkdown preview works.\n',
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NO_SANDBOX;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env });
    const page = await application.firstWindow();
    const rendererErrors: string[] = [];
    page.on('pageerror', (error) => rendererErrors.push(error.message));
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1440, 940);
    });
    await application.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
    }, projectRoot);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    const editorPane = page.locator('.editor-pane');
    const recentCard = page.locator('.welcome-recent-card');
    await expect(recentCard).toBeVisible();
    const savedPaneStyle = await editorPane.getAttribute('style');
    await editorPane.evaluate((pane) => {
      pane.style.width = '420px';
      pane.style.flex = '0 0 420px';
    });
    await expect
      .poll(async () => {
        const [paneBounds, cardBounds] = await Promise.all([
          editorPane.boundingBox(),
          recentCard.boundingBox(),
        ]);
        return (
          !!paneBounds &&
          !!cardBounds &&
          cardBounds.x + cardBounds.width <= paneBounds.x + paneBounds.width + 1
        );
      })
      .toBe(true);
    await expect(recentCard.locator('.welcome-recent-name').first()).toBeVisible();
    await expect
      .poll(() =>
        recentCard
          .locator('.welcome-recent-path')
          .first()
          .evaluate((path) => path.scrollWidth > path.clientWidth),
      )
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath('welcome-recent-narrow.png') });
    if (savedPaneStyle === null) await editorPane.evaluate((pane) => pane.removeAttribute('style'));
    else
      await editorPane.evaluate((pane, style) => pane.setAttribute('style', style), savedPaneStyle);
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await expect(page.locator('.source-editor')).toBeVisible();
    const fontSizeControl = page.locator('.editor-format-font-size');
    const wrapControl = page.locator('.editor-format-wrap-control');
    const [fontSizeBounds, wrapBounds] = await Promise.all([
      fontSizeControl.boundingBox(),
      wrapControl.boundingBox(),
    ]);
    expect(fontSizeBounds).not.toBeNull();
    expect(wrapBounds).not.toBeNull();
    expect(wrapBounds!.x - fontSizeBounds!.x - fontSizeBounds!.width).toBeGreaterThanOrEqual(5);
    const wrapButton = page.getByRole('button', { name: 'Toggle word wrap' });
    await expect(wrapButton).not.toHaveAttribute('title');
    await wrapButton.hover();
    await expect(page.getByRole('tooltip')).toContainText('Word wrap');

    const previewToggle = page.getByRole('button', { name: 'Toggle preview' });
    await expect(previewToggle).not.toHaveAttribute('title');
    await previewToggle.hover();
    await expect(page.getByRole('tooltip')).toContainText('preview');

    await page.getByRole('button', { name: 'Writing tools' }).click();
    const outlineSection = page.getByRole('button', { name: 'Outline', exact: true });
    await expect(outlineSection).toHaveAttribute('aria-expanded', 'true');
    await outlineSection.click();
    await expect(outlineSection).toHaveAttribute('aria-expanded', 'false');
    await outlineSection.click();
    await page.getByRole('button', { name: 'History & Projects' }).click();
    const historySection = page.getByRole('button', { name: 'File History', exact: true });
    const recentProjectsSection = page.getByRole('button', {
      name: 'Recent Projects',
      exact: true,
    });
    await expect(historySection).toHaveAttribute('aria-expanded', 'true');
    await expect(recentProjectsSection).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Recover earlier history…', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('history-project-sections.png') });

    const compileGroup = page.getByRole('group', { name: 'Compile controls', exact: true });
    await expect(compileGroup).toBeVisible();
    const compile = page.getByRole('button', { name: 'Compile active document', exact: true });
    const recipe = page.getByRole('button', { name: 'Choose compile recipe', exact: true });
    const aligned = await Promise.all([compile, recipe].map((button) => button.boundingBox()));
    expect(aligned[0]).not.toBeNull();
    expect(aligned[1]).not.toBeNull();
    expect(Math.abs(aligned[0]!.y - aligned[1]!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(aligned[0]!.height - aligned[1]!.height)).toBeLessThanOrEqual(1);
    await expect(page.locator('.preview-pane .panel-state')).toContainText('PDF preview');
    await page.screenshot({ path: test.info().outputPath('workspace-wide.png') });

    await recipe.click();
    const recipeMenu = page.getByRole('menu', { name: 'Choose compile recipe', exact: true });
    await expect(recipeMenu).toBeVisible();
    const currentRecipe = recipeMenu.getByRole('menuitemradio', { checked: true });
    await expect(currentRecipe).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(recipeMenu).toBeHidden();

    await page.getByRole('button', { name: 'Build', exact: true }).click();
    const buildSidebar = page.locator('.compile-sidebar');
    const buildRecipe = buildSidebar.getByRole('button', { name: 'Choose compile recipe' });
    await expect(buildRecipe).toBeVisible();
    await expect(buildSidebar.getByRole('button', { name: 'Current recipe step 1' })).toBeEnabled();
    const buildControls = buildSidebar.getByRole('group', { name: 'Compile controls' });
    const buildCompile = buildControls.getByRole('button', { name: 'Compile active document' });
    const [buildBounds, compileBounds] = await Promise.all([
      buildRecipe.boundingBox(),
      buildCompile.boundingBox(),
    ]);
    expect(buildBounds).not.toBeNull();
    expect(compileBounds).not.toBeNull();
    expect(Math.abs(buildBounds!.y - compileBounds!.y)).toBeLessThanOrEqual(1);
    const buildHeader = await buildSidebar.locator('.build-sidebar-title').boundingBox();
    expect(buildHeader).not.toBeNull();
    expect(buildBounds!.x + buildBounds!.width).toBeLessThanOrEqual(
      buildHeader!.x + buildHeader!.width + 1,
    );
    await page.screenshot({ path: test.info().outputPath('build-sidebar.png') });
    await buildRecipe.click();
    await expect(
      page.getByRole('menu', { name: 'Choose compile recipe', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'File Explorer', exact: true }).click();
    await page.getByRole('button', { name: 'Open notes.md', exact: true }).click();
    const markdownPreviewButton = page.getByRole('button', { name: 'View Markdown preview' });
    await expect(markdownPreviewButton).toBeEnabled();
    await markdownPreviewButton.click();
    await expect(page.locator('.preview-pane')).toContainText('Markdown preview');
    await expect(page.locator('.markdown-preview')).toContainText('Markdown preview works.');
    await page.getByRole('button', { name: 'Save file as' }).click();
    await page.getByRole('textbox', { name: 'Path' }).fill('notes-copy.md');
    await page.getByRole('button', { name: 'Save copy', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Open notes-copy.md', exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    const theme = page.getByRole('button', { name: 'Theme', exact: true });
    await theme.click();
    const themeMenu = page.getByRole('menu', { name: 'Theme', exact: true });
    await expect(themeMenu).toBeVisible();
    const menuIsHitTestable = await themeMenu.evaluate((menu) => {
      const rect = menu.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return !!top && (top === menu || menu.contains(top));
    });
    expect(menuIsHitTestable).toBe(true);
    await page.screenshot({ path: test.info().outputPath('settings-theme-menu.png') });
    await themeMenu.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('settings-light.png') });
    await theme.click();
    await themeMenu.getByRole('menuitemradio', { name: 'Dark (default)', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    const minimapHelp = page.getByRole('button', { name: 'Help: Show minimap', exact: true });
    await expect(minimapHelp).toHaveCSS('font-size', '9px');
    await expect(minimapHelp).toHaveCSS('opacity', '0.58');
    await minimapHelp.hover();
    await expect(page.getByRole('tooltip')).toContainText('compact overview');
    const minimapSwitch = page.getByRole('switch', { name: 'Show minimap', exact: true });
    await minimapSwitch.check();
    await expect(minimapSwitch).toBeChecked();
    await page.screenshot({ path: test.info().outputPath('settings-editor.png') });
    await expect(page.locator('.setting-pair-control .setting-integer').first()).toHaveCSS(
      'height',
      '28px',
    );
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.screenshot({ path: test.info().outputPath('settings-files.png') });
    await page.getByRole('button', { name: 'Compilation', exact: true }).click();
    const recipeEditor = page.locator('.compile-recipe-editor');
    await expect(recipeEditor).toBeVisible();
    const steps = recipeEditor.locator('.compile-recipe-step');
    const startingStepCount = await steps.count();
    await recipeEditor.getByRole('button', { name: 'Add a step to this recipe' }).click();
    await expect(steps).toHaveCount(startingStepCount + 1);
    await expect(recipeEditor.getByRole('button', { name: 'Move step 2 up' })).toBeEnabled();
    await expect(
      recipeEditor.getByRole('button', { name: 'Project default recipe' }),
    ).toBeEnabled();
    await recipeEditor.getByRole('button', { name: 'Save to user recipes' }).click();
    await expect
      .poll(async () => {
        const result = await page.evaluate(() => window.textra.getPreferences());
        return result.ok ? result.value.globalBuildRecipes?.recipes.length : -1;
      })
      .toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath('settings-compilation.png') });
    for (const [section, screenshot] of [
      ['Shortcuts', 'settings-shortcuts.png'],
      ['LaTeX tools', 'settings-latex-tools.png'],
      ['AI Settings', 'settings-ai.png'],
      ['Import & export', 'settings-import-export.png'],
    ] as const) {
      await page.getByRole('button', { name: section, exact: true }).click();
      if (section === 'AI Settings') {
        await expect(
          page.getByRole('heading', { name: 'Chat Settings', exact: true }),
        ).toBeVisible();
      }
      await page.screenshot({ path: test.info().outputPath(screenshot) });
    }
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();

    const tabsMenuButton = page.getByRole('button', { name: 'Preview menu', exact: true });
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(900, 640);
    });
    await page.screenshot({ path: test.info().outputPath('workspace-compact.png') });
    await page.locator('.preview-tabs-host').evaluate((host) => {
      // Force the narrow responsive branch after the 900 px screenshot; native
      // window chrome and display scaling make that threshold machine-specific.
      (host as HTMLElement).style.flex = '0 0 100px';
    });
    await expect(tabsMenuButton).toBeVisible();
    await tabsMenuButton.click();
    const views = page.getByRole('dialog', { name: 'Preview views and controls', exact: true });
    await expect(views).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('preview-menu-compact.png') });
    await views.getByRole('button', { name: 'Problems', exact: true }).click();
    await expect(views).toBeHidden();
    await expect(page.getByRole('tabpanel')).toContainText('No diagnostics yet.');
    expect(rendererErrors).toEqual([]);
  } finally {
    await application?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
