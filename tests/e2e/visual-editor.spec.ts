import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

test('visual editing preserves LaTeX and shares save and undo with code mode', async () => {
  test.setTimeout(120000);
  const parent = join(process.cwd(), 'test-results', 'visual-editor');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const root = join(directory, 'project');
  const userData = join(directory, 'profile');
  await mkdir(root);
  await mkdir(userData);
  const original = [
    '\\documentclass{article}',
    '\\usepackage{enumitem}',
    '\\usepackage{hyperref}',
    '\\newcommand{\\textratestcustom}[1]{#1}',
    '% Preserve this preamble comment.',
    '\\begin{document}',
    '\\section{Introduction}',
    'First paragraph.',
    '',
    "Punctuation uses -- and --- plus \x60\x60quoted''.",
    '',
    'A \\href{https://example.org}{visible link} with \\pounds{} and \\' + "'{e}" + '.',
    '',
    '\\underline{Underlined} \\textsc{Small caps} \\textsuperscript{2} \\textsubscript{x}.',
    '',
    'A note\\footnote{Original note.}.',
    '',
    'Commented prose. % Keep this comment',
    '',
    'See Figure~\\ref{fig:one} and \\crefrange{fig:one}{fig:two}.',
    '',
    'A formula $x^2$ and a citation \\cite{example}.',
    '',
    'A custom equation $\\textratestcustom{z}$.',
    '',
    'Included \\input{child}.',
    '',
    '\\begin{itemize}[leftmargin=2em]',
    '\\item[Custom] Outer item',
    '\\begin{enumerate}',
    '\\item Nested item',
    '\\end{enumerate}',
    '\\end{itemize}',
    '',
    '\\begin{quote}',
    'A quoted paragraph.',
    '\\end{quote}',
    '',
    '\\begin{figure}',
    '\\caption{Keep this figure exactly.}',
    '\\end{figure}',
    '\\end{document}',
    '',
  ].join('\n');
  const file = join(root, 'main.tex');
  await writeFile(file, original);
  await writeFile(join(root, 'child.tex'), 'Child document.');
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
      BrowserWindow.getAllWindows()[0].setSize(1440, 900);
    }, root);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    const source = page.getByTestId('source-editor');
    const save = page.getByRole('button', { name: 'Save file', exact: true });
    const visualMode = page.getByRole('radio', { name: 'Visual', exact: true });
    const codeMode = page.getByRole('radio', { name: 'Code', exact: true });
    const visual = page.getByRole('textbox', { name: 'Visual LaTeX editor', exact: true });
    await expect(source).toContainText('First paragraph.');
    await expect(codeMode).toBeChecked();
    await expect(save).toBeDisabled();

    const dimensions = await page.locator('.editor-format-toolbar').evaluate((toolbar) => {
      const control = toolbar.querySelector('.editor-mode-control');
      if (!control) throw new Error('Editor mode control is missing.');
      return {
        toolbar: toolbar.getBoundingClientRect().height,
        control: control.getBoundingClientRect().height,
        right: control.getBoundingClientRect().right,
        toolbarRight: toolbar.getBoundingClientRect().right,
      };
    });
    expect(dimensions.toolbar).toBeCloseTo(29, 0);
    expect(dimensions.control).toBeCloseTo(24, 0);
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.toolbarRight);

    await visualMode.click();
    await expect(visualMode).toBeChecked();
    await expect(visual).toBeVisible();
    await expect(source).toBeHidden();
    await expect(visual).toContainText('First paragraph.');
    await expect(visual.getByRole('heading', { name: 'Introduction' })).toBeVisible();
    const unsupportedMath = visual
      .locator('.visual-math')
      .filter({ hasText: '\\textratestcustom' });
    await expect(unsupportedMath.locator('.katex')).toBeVisible();
    await unsupportedMath.click();
    const unsupportedSource = visual.getByRole('textbox', { name: 'Equation LaTeX', exact: true });
    await expect(unsupportedSource).toHaveValue('$\\textratestcustom{z}$');
    await page.keyboard.press('Escape');
    const punctuation = visual.locator('p').filter({ hasText: 'Punctuation uses' });
    await expect(punctuation).toHaveText("Punctuation uses -- and --- plus \x60\x60quoted''.");
    await expect(punctuation.locator('button')).toHaveCount(0);
    await expect(visual.locator('u').filter({ hasText: 'Underlined' })).toBeVisible();
    await expect(
      visual.locator('[data-small-caps]').filter({ hasText: 'Small caps' }),
    ).toBeVisible();
    await expect(visual.locator('sup').filter({ hasText: '2' })).toBeVisible();
    await expect(visual.locator('sub').filter({ hasText: 'x' })).toBeVisible();
    const link = visual.getByRole('button', { name: 'Edit source: href: visible link' });
    await expect(link).toHaveText('visible link');
    await link.click();
    const linkSource = visual.getByRole('textbox', { name: 'LaTeX source', exact: true });
    await expect(linkSource).toHaveValue('\\href{https://example.org}{visible link}');
    expect(
      await linkSource.evaluate((field) => (field as HTMLTextAreaElement).selectionStart),
    ).toBe('\\href{https://example.org}{visible link}'.length - 1);
    await linkSource.fill('\\href{https://example.org}{updated link}');
    await page.keyboard.press('Enter');
    await expect(
      visual.getByRole('button', { name: 'Edit source: href: updated link' }),
    ).toBeVisible();
    await visual.focus();
    await page.keyboard.press('Control+z');
    await expect(link).toBeVisible();
    const symbol = visual.getByRole('button', { name: 'Edit source: \\pounds{}' });
    await expect(symbol).toHaveText('£');
    await symbol.click();
    await expect(linkSource).toHaveValue('\\pounds{}');
    await linkSource.fill('\\textsterling{}');
    await page.keyboard.press('Enter');
    await expect(visual.getByRole('button', { name: 'Edit source: \\textsterling{}' })).toHaveText(
      '£',
    );
    await visual.focus();
    await page.keyboard.press('Control+z');
    await expect(symbol).toBeVisible();
    await expect(visual.getByRole('button', { name: "Edit source: \\'{e}" })).toHaveText('é');
    const visualReference = visual.getByRole('button', { name: 'Edit source: ref: fig:one' });
    await expect(visualReference).toHaveText('fig:one');
    await expect(
      visual.getByRole('button', { name: 'Edit source: crefrange: fig:one–fig:two' }),
    ).toHaveText('fig:one–fig:two');
    const nonbreakingSpace = visual.locator('[data-visual-nbsp="true"]');
    await expect(nonbreakingSpace).toHaveText('\u00a0');
    await expect(nonbreakingSpace.locator('button')).toHaveCount(0);
    await visualReference.focus();
    await page.keyboard.press('Enter');
    const inlineSource = visual.getByRole('textbox', { name: 'LaTeX source', exact: true });
    await expect(inlineSource).toHaveValue('\\ref{fig:one}');
    await page.keyboard.press('Escape');
    await expect(inlineSource).toHaveCount(0);
    const comment = visual.getByRole('button', { name: 'Edit comment', exact: true });
    await expect(comment).toHaveText('%');
    await comment.click();
    await expect(inlineSource).toHaveValue(' % Keep this comment\n');
    await page.keyboard.press('Escape');
    const footnote = visual.getByRole('button', { name: 'Edit footnote', exact: true });
    await expect(footnote).toHaveText('^');
    await footnote.focus();
    await page.keyboard.press('Enter');
    await expect(inlineSource).toHaveValue('\\footnote{Original note.}');
    await inlineSource.fill('\\footnote{Updated note.}');
    await page.keyboard.press('Enter');
    await expect(visual).toHaveAttribute('contenteditable', 'true');
    await footnote.click();
    await expect(inlineSource).toHaveValue('\\footnote{Updated note.}');
    await page.keyboard.press('Escape');
    await visual.focus();
    await page.keyboard.press('Control+z');
    await visual.evaluate((element) => {
      const space = element.querySelector('[data-visual-nbsp="true"]');
      if (!space) throw new Error('Visual nonbreaking space was not found.');
      (element as HTMLElement).focus();
      const range = document.createRange();
      range.setStartAfter(space);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press('Backspace');
    await expect(nonbreakingSpace).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(nonbreakingSpace).toHaveCount(1);
    await punctuation.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let mark = walker.nextNode();
      while (mark && !mark.textContent?.includes('--')) mark = walker.nextNode();
      if (!mark || !mark.textContent) throw new Error('Visual punctuation was not found.');
      (element.closest('[role="textbox"]') as HTMLElement).focus();
      const range = document.createRange();
      range.setStart(mark, mark.textContent.indexOf('--') + 1);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press('Backspace');
    await expect(punctuation).toHaveText("Punctuation uses - and --- plus \x60\x60quoted''.");
    await page.keyboard.press('Control+z');
    await expect(punctuation).toHaveText("Punctuation uses -- and --- plus \x60\x60quoted''.");
    await expect(save).toBeDisabled();
    await expect(visual.locator('ul ol li')).toContainText('Nested item');
    expect(
      await visual
        .locator('ul')
        .first()
        .evaluate((element) => getComputedStyle(element).listStyleType),
    ).toBe('disc');
    expect(
      await visual
        .locator('ul ol')
        .first()
        .evaluate((element) => getComputedStyle(element).listStyleType),
    ).toBe('decimal');
    expect(
      await visual
        .locator('ul > li')
        .first()
        .evaluate((element) => getComputedStyle(element).display),
    ).toBe('list-item');
    await expect(visual.locator('ul > li').first()).toHaveAttribute(
      'data-visual-item-label',
      'Custom',
    );
    expect(
      await visual
        .locator('ul > li')
        .first()
        .evaluate((element) => getComputedStyle(element, '::marker').content),
    ).not.toBe('normal');
    await expect(visual.locator('blockquote')).toContainText('A quoted paragraph.');
    await expect(visual.getByText('Edit source', { exact: true })).toHaveCount(0);
    await visual.getByRole('button', { name: 'Open file: child', exact: true }).click();
    await expect(visual).toContainText('Child document.');
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await expect(visual).toContainText('First paragraph.');
    const figureTrigger = visual.getByRole('button', { name: 'Edit source: figure', exact: true });
    await expect(figureTrigger).toHaveText('figure');
    await figureTrigger.focus();
    await page.keyboard.press('Enter');
    const figure = visual.getByRole('textbox', { name: 'LaTeX source', exact: true });
    await expect(figure).toBeVisible();
    await expect(figure).toHaveValue(
      '\\begin{figure}\n\\caption{Keep this figure exactly.}\n\\end{figure}',
    );
    await page.getByRole('button', { name: 'Cancel source', exact: true }).click();
    await figureTrigger.locator('..').click({ position: { x: 2, y: 2 } });
    await expect(figure).toBeVisible();
    await page.getByRole('button', { name: 'Cancel source', exact: true }).click();
    await expect(save).toBeDisabled();
    expect(await readFile(file, 'utf8')).toBe(original);

    const visualBackgrounds: string[] = [];
    for (const theme of ['Light', 'Dark']) {
      await page.keyboard.press('Control+k');
      await page
        .getByRole('combobox', { name: 'Search commands and files', exact: true })
        .fill(`Switch theme: ${theme}`);
      await page.getByRole('option', { name: `Switch theme: ${theme}`, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
      visualBackgrounds.push(
        await page
          .getByTestId('visual-editor')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      );
      await page.screenshot({ path: test.info().outputPath(`visual-${theme.toLowerCase()}.png`) });
    }
    expect(visualBackgrounds[0]).not.toBe(visualBackgrounds[1]);
    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByText('Create and save a new theme…', { exact: true }).click();
    await page.getByLabel('New theme name').fill('Visual test theme');
    await page.getByLabel('New theme background').fill('#233344');
    await page.getByLabel('New theme text').fill('#f0f2f5');
    await page.getByRole('button', { name: 'Save theme to picker', exact: true }).click();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await expect
      .poll(() =>
        page
          .getByTestId('visual-editor')
          .evaluate((element) => getComputedStyle(element).backgroundColor),
      )
      .toBe('rgb(35, 51, 68)');
    await page.screenshot({ path: test.info().outputPath('visual-custom.png') });
    await page.keyboard.press('Control+k');
    await page
      .getByRole('combobox', { name: 'Search commands and files', exact: true })
      .fill('Switch theme: Dark');
    await page.getByRole('option', { name: 'Switch theme: Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    for (const zoom of [1.25, 1.5, 1]) {
      await application.evaluate(({ BrowserWindow }, factor) => {
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor);
      }, zoom);
      await expect(visualMode).toBeVisible();
      const bounds = await page.locator('.editor-format-toolbar').evaluate((toolbar) => {
        const control = toolbar.querySelector('.editor-mode-control')!.getBoundingClientRect();
        const container = toolbar.getBoundingClientRect();
        return { left: control.left - container.left, right: container.right - control.right };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeGreaterThanOrEqual(0);
      if (zoom === 1.5)
        await page.screenshot({ path: test.info().outputPath('visual-zoom-150.png') });
    }
    await visualMode.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(codeMode).toBeChecked();
    await page.keyboard.press('ArrowRight');
    await expect(visualMode).toBeChecked();
    await expect(visual).toBeVisible();

    // A mode change alone does not dirty or rewrite the document.
    await codeMode.click();
    await expect(source).toBeVisible();
    await expect(save).toBeDisabled();
    expect(await readFile(file, 'utf8')).toBe(original);
    await page.evaluate(() => {
      const measurement = window as Window & { visualToggleMs?: number };
      const mode = [...document.querySelectorAll('[role="radio"]')].find(
        (candidate) => candidate.textContent?.trim() === 'Visual',
      );
      if (!mode) throw new Error('Visual mode control was not found');
      mode.addEventListener(
        'click',
        () => {
          const started = performance.now();
          const observer = new MutationObserver(() => {
            const surface = document.querySelector<HTMLElement>('[data-testid="visual-editor"]');
            if (surface && !surface.hidden) {
              observer.disconnect();
              requestAnimationFrame(() => {
                measurement.visualToggleMs = performance.now() - started;
              });
            }
          });
          observer.observe(document.body, {
            attributes: true,
            subtree: true,
            attributeFilter: ['hidden'],
          });
        },
        { once: true },
      );
    });
    await visualMode.click();
    await expect(visual).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => (window as Window & { visualToggleMs?: number }).visualToggleMs),
      )
      .not.toBeUndefined();
    const warmToggleMs = await page.evaluate(
      () => (window as Window & { visualToggleMs?: number }).visualToggleMs,
    );
    console.info('Prepared Visual mode render milliseconds:', warmToggleMs);

    await visual.locator('p').filter({ hasText: 'First paragraph.' }).click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' 50% A_B');
    await expect(visual).toContainText('First paragraph. 50% A_B');
    await expect(save).toBeEnabled();

    // The undo stack belongs to the shared source model, including across the mode switch.
    await codeMode.click();
    await expect(source).toBeVisible();
    await expect(source).toContainText('50\\% A\\_B');
    await source.click();
    await page.keyboard.press('Control+z');
    await expect(source).not.toContainText('50\\% A\\_B');
    await page.keyboard.press('Control+y');
    await expect(source).toContainText('50\\% A\\_B');
    await visualMode.click();
    await expect(visual).toBeVisible();
    await expect(visual).toContainText('First paragraph. 50% A_B');
    await punctuation.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' Revised.');
    await expect(punctuation).toContainText("quoted''. Revised.");

    await visual.getByRole('button', { name: 'Edit equation', exact: true }).first().click();
    const equation = visual.getByRole('textbox', { name: 'Equation LaTeX', exact: true });
    await expect(equation).toBeVisible();
    await equation.fill('$x^3$');
    await page.keyboard.press('Enter');
    await expect(equation).toHaveCount(0);
    await expect(visual).toHaveAttribute('contenteditable', 'true');

    // Editing a list item must retain its original environment options and item label.
    const outerItem = visual.locator('ul > li > p').filter({ hasText: 'Outer item' }).first();
    await expect(outerItem).toBeVisible();
    await outerItem.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' revised');
    await expect(outerItem).toContainText('Outer item revised');

    await page.keyboard.press('Control+s');
    await expect
      .poll(() => readFile(file, 'utf8'), { timeout: 15000 })
      .toContain('First paragraph. 50\\% A\\_B');
    const saved = await readFile(file, 'utf8');
    expect(saved).toContain('$x^3$');
    expect(saved).toContain('% Preserve this preamble comment.');
    expect(saved).toContain('\\cite{example}');
    expect(saved).toContain("Punctuation uses -- and --- plus \x60\x60quoted''. Revised.");
    expect(saved).toContain('\\begin{itemize}[leftmargin=2em]');
    expect(saved).toContain('\\item[Custom] Outer item revised');
    expect(saved).toContain('\\begin{enumerate}\n\\item Nested item\n\\end{enumerate}');
    expect(saved).toContain('\\begin{quote}\nA quoted paragraph.\n\\end{quote}');
    expect(saved).toContain('\\begin{figure}\n\\caption{Keep this figure exactly.}\n\\end{figure}');
    await expect(save).toBeDisabled();

    // Keep the attempted equation edit when the authoritative buffer changes underneath it.
    await visual.getByRole('button', { name: 'Edit equation', exact: true }).first().click();
    await equation.fill('$x^4$');
    await page.evaluate(
      (updated) => {
        window.dispatchEvent(
          new CustomEvent('textra:apply-document-content', {
            detail: { path: 'main.tex', text: updated },
          }),
        );
      },
      saved.replace('$x^3$', '$z$'),
    );
    await page.getByRole('button', { name: 'Apply source', exact: true }).click();
    const recovery = page.getByRole('dialog', { name: 'Recover visual edit', exact: true });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole('textbox', { name: 'Recovered LaTeX draft' })).toHaveValue(
      /\$x\^4\$/,
    );
    await recovery.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await codeMode.click();
    await expect(source).toContainText('$z$');

    await visualMode.click();
    await expect(visual).toBeVisible();
    await visual.locator('p').filter({ hasText: 'First paragraph.' }).click();
    await page.keyboard.press('End');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'é', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.insertText', { text: 'é' });
    const composedParagraph = visual.locator('p').filter({ hasText: 'First paragraph.' });
    await expect(composedParagraph).toContainText('é');
    expect((await composedParagraph.textContent())?.match(/é/g)).toHaveLength(1);
    await codeMode.click();
    await expect(source).toContainText('é');
    await expect(source).toContainText('A\\_B');
    await cdp.detach();

    await visualMode.click();
    await expect(visual).toBeVisible();
    await visual
      .locator('p')
      .filter({ hasText: 'A formula' })
      .click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('End');
    await page.keyboard.press('Control+i');
    await expect(codeMode).toBeChecked();
    await expect(
      page.getByText('Choose a source location in Code mode before using inline editing here.', {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await application
      ?.evaluate(({ app }) => {
        setImmediate(() => app.exit(0));
      })
      .catch(() => undefined);
    await application?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('visual and code clients merge shared edits without undoing their peer', async () => {
  test.setTimeout(180000);
  const parent = join(process.cwd(), 'test-results', 'visual-collaboration');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const root = join(directory, 'project');
  const profileA = join(directory, 'profile-a');
  const profileB = join(directory, 'profile-b');
  await Promise.all([mkdir(root), mkdir(profileA), mkdir(profileB)]);
  const file = join(root, 'main.tex');
  await writeFile(file, 'Shared prose.\n');
  await writeFile(join(root, 'other.tex'), 'Other tab.\n');
  const envFor = (profile: string): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env))
      if (value !== undefined) env[key] = value;
    env.TEXTRA_USER_DATA_DIR = profile;
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NO_SANDBOX;
    delete env.ELECTRON_CLI_ARGS;
    return env;
  };
  const openShared = async (app: ElectronApplication): Promise<Page> => {
    await app.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
    }, root);
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    await page.getByRole('button', { name: 'Collaboration', exact: true }).click();
    await page.getByRole('radio', { name: 'Background merge', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Background merge', exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('button', { name: 'Open other.tex', exact: true }).click();
    await expect(page.locator('.monaco-editor .view-lines')).toBeVisible();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await expect(page.locator('.monaco-editor .view-lines')).toBeVisible();
    // The Yjs/Monaco binding is installed asynchronously on tab activation.
    await page.waitForTimeout(1000);
    return page;
  };
  let appA: ElectronApplication | undefined;
  let appB: ElectronApplication | undefined;
  try {
    appA = await electron.launch({ args: ['.'], env: envFor(profileA) });
    const pageA = await openShared(appA);
    await pageA.getByRole('radio', { name: 'Visual', exact: true }).click();
    const visual = pageA.getByRole('textbox', { name: 'Visual LaTeX editor', exact: true });
    await expect(visual).toBeVisible();
    await visual.locator('p').filter({ hasText: 'Shared prose.' }).click();
    await pageA.keyboard.press('End');
    await pageA.keyboard.insertText(' First');
    await expect(visual).toContainText('Shared prose. First');
    await pageA.keyboard.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8'), { timeout: 15000 }).toContain('First');

    appB = await electron.launch({ args: ['.'], env: envFor(profileB) });
    const pageB = await openShared(appB);
    const source = pageB.getByRole('textbox', { name: 'LaTeX source editor', exact: true });
    await source.focus();
    await pageB.keyboard.press('Control+End');
    await pageB.keyboard.press('Enter');
    await pageB.keyboard.insertText('Peer B');
    await expect(pageB.getByTestId('source-editor')).toContainText('Peer B');

    // A second local edit and the other profile's unsaved edit must both survive the merge.
    await visual.locator('p').filter({ hasText: 'Shared prose.' }).click();
    await pageA.keyboard.press('End');
    await pageA.keyboard.insertText(' Local A');
    await expect(visual).toContainText('Local A');
    await pageA.keyboard.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8'), { timeout: 30000 }).toContain('Peer B');
    await expect.poll(() => readFile(file, 'utf8'), { timeout: 30000 }).toContain('Local A');
    await expect(visual).toContainText('Peer B', { timeout: 30000 });
    await expect(pageA.locator('.conflict-banner')).toHaveCount(0);
    await expect(pageB.locator('.conflict-banner')).toHaveCount(0);

    await visual.click();
    await pageA.keyboard.press('Control+z');
    await expect(visual).toContainText('Peer B');
    await pageA.keyboard.press('Control+s');
    await expect.poll(() => readFile(file, 'utf8'), { timeout: 15000 }).toContain('Peer B');
  } finally {
    await appB
      ?.evaluate(({ app }) => {
        setImmediate(() => app.exit(0));
      })
      .catch(() => undefined);
    await appA
      ?.evaluate(({ app }) => {
        setImmediate(() => app.exit(0));
      })
      .catch(() => undefined);
    await appB?.close().catch(() => undefined);
    await appA?.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
