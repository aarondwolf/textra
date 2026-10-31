import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

test('visual display math renders and opens its exact source in place', async () => {
  test.setTimeout(120000);
  const parent = join(process.cwd(), 'test-results', 'visual-math');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const root = join(directory, 'project');
  const userData = join(directory, 'profile');
  await mkdir(root);
  await mkdir(userData);
  const math = [
    '\\begin{equation}\nx=1\\label{eq:one}\n\\end{equation}',
    '\\begin{equation*}\nx=2\n\\end{equation*}',
    '\\begin{align}\nx&=3\\\\\ny&=4\\label{eq:two}\n\\end{align}',
    '\\begin{align*}\nx&=5\\\\\ny&=6\n\\end{align*}',
    '\\[ z=7 \\]',
    '$$ w=8 $$',
    '\\begin{equation}\\label{eq:gap}\n R_{f,t+h} = \\alpha_b + \\sum_b \\Delta_b\\,\\mathbf{1}\\{B_f=b\\}\\,T + \\big[\\,\\kappa\\ln L_{ft} + \\FE\\,\\big] + u_{ft}.\n\\end{equation}',
  ];
  const original = [
    '\\documentclass{article}',
    '\\usepackage{amsmath}',
    '\\newcommand{\\FE}{\\operatorname{FE}}',
    '\\begin{document}',
    ...math,
    '\\end{document}',
    '',
  ].join('\n\n');
  const file = join(root, 'main.tex');
  await writeFile(file, original);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env });
    const page = await application.firstWindow();
    await application.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
    }, root);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await page.getByRole('radio', { name: 'Visual', exact: true }).click();
    const visual = page.getByRole('textbox', { name: 'Visual LaTeX editor', exact: true });
    await expect(visual).toBeVisible();
    const equations = visual.getByRole('button', { name: 'Edit equation', exact: true });
    await expect(equations).toHaveCount(math.length);
    await expect(visual.locator('.visual-math-error')).toHaveCount(0);
    await expect(visual.locator('.visual-math-block .katex')).toHaveCount(math.length);
    const userEquation = equations.nth(math.length - 1);
    await expect(userEquation.locator('.katex-html')).toContainText('\\FE');
    await expect(userEquation.locator('.katex-html .msupsub').first()).toBeVisible();
    for (let index = 0; index < math.length; index++) {
      await equations.nth(index).click();
      const source = visual.getByRole('textbox', { name: 'Equation LaTeX', exact: true });
      await expect(source).toHaveValue(math[index]);
      await page.keyboard.press('Escape');
      await expect(source).toHaveCount(0);
    }
    await expect(
      page.locator('.editor-format-actions button[aria-label="Save file"]'),
    ).toBeDisabled();
    expect(await readFile(file, 'utf8')).toBe(original);

    const revised = math[math.length - 1].replace('\\FE', '\\FE_{ft}');
    await userEquation.click();
    const source = visual.getByRole('textbox', { name: 'Equation LaTeX', exact: true });
    await source.fill(revised);
    await page.keyboard.press('Escape');
    await expect(source).toHaveCount(0);
    await expect(
      page.locator('.editor-format-actions button[aria-label="Save file"]'),
    ).toBeDisabled();
    expect(await readFile(file, 'utf8')).toBe(original);

    await userEquation.click();
    await expect(source).toHaveValue(math[math.length - 1]);
    await source.fill(revised);
    await page.keyboard.press('Control+Enter');
    await expect(source).toHaveCount(0);
    await expect(visual).toHaveAttribute('contenteditable', 'true');
    await expect(userEquation.locator('.katex-html')).toContainText('\\FE');
    await page.keyboard.press('Control+s');
    const expected = original.replace(math[math.length - 1], () => revised);
    await expect.poll(() => readFile(file, 'utf8'), { timeout: 15000 }).toBe(expected);
    expect(expected).toContain('\\label{eq:gap}');
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
