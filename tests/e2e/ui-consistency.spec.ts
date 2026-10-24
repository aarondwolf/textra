import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('sidebar palette scrolls as one view and settings controls retain their borders', async () => {
  test.setTimeout(90000);
  const parent = join(process.cwd(), 'test-results', 'ui-consistency');
  await mkdir(parent, { recursive: true });
  const userData = await mkdtemp(join(parent, 'profile-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env });
    const page = await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1000, 700);
    });
    await page.getByRole('button', { name: 'Snippets & Symbols', exact: true }).click();
    const palette = page.locator('.snippet-palette');
    await expect(palette).toBeVisible();
    // Both groups default to collapsed. Expand them before measuring the full palette.
    for (const name of [/^Math Symbols/, /^Templates & Snippets/]) {
      const section = palette.getByRole('button', { name });
      await expect(section).toHaveAttribute('aria-expanded', 'false');
      await section.click();
      await expect(section).toHaveAttribute('aria-expanded', 'true');
    }
    expect(await palette.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
      true,
    );
    expect(
      await palette
        .locator('.palette-sections, .palette-section-content')
        .evaluateAll((elements) =>
          elements.some((element) =>
            ['auto', 'scroll'].includes(getComputedStyle(element).overflowY),
          ),
        ),
    ).toBe(false);
    const scrollbar = await palette.evaluate((element) => ({
      width: getComputedStyle(element, '::-webkit-scrollbar').width,
      arrows: getComputedStyle(element, '::-webkit-scrollbar-button').display,
    }));
    expect(scrollbar).toEqual({ width: '5px', arrows: 'none' });
    await page.screenshot({ path: test.info().outputPath('symbols-top.png') });
    await palette.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => palette.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Add snippet', exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Add snippet', exact: true }).click();
    await expect(page.getByPlaceholder('Snippet name (e.g. My Theorem)')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('snippets-bottom.png') });

    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    const theme = page.getByRole('button', { name: 'Theme', exact: true });
    for (const value of ['dark', 'light']) {
      await theme.click();
      await page
        .getByRole('menuitemradio', {
          name: value === 'dark' ? 'Dark (default)' : 'Light',
          exact: true,
        })
        .click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', value);
      const bounds = await theme.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const scroll = element.closest('.setup-scroll')!.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          insetLeft: rect.left - scroll.left,
          insetRight: scroll.right - rect.right,
          radius: style.borderTopLeftRadius,
          border: style.borderLeftWidth,
          rightBorder: style.borderRightWidth,
          backgroundClip: style.backgroundClip,
        };
      });
      expect(bounds.insetLeft).toBeGreaterThanOrEqual(2);
      expect(bounds.insetRight).toBeGreaterThanOrEqual(2);
      expect(bounds.radius).toBe('999px');
      // Chromium snaps borders to device pixels under Windows display scaling.
      expect(parseFloat(bounds.border)).toBeGreaterThan(0);
      expect(bounds.border).toBe(bounds.rightBorder);
      expect(bounds.backgroundClip).toBe('border-box');
      await page.screenshot({ path: test.info().outputPath(`appearance-${value}.png`) });
    }
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  } finally {
    await application?.close();
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
