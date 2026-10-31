import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/** A tiny valid one-page PDF, built with the same fixture pattern as startup tests. */
function fixturePdf(): Buffer {
  const content = 'BT /F1 16 Tf 30 80 Td (Figure fixture) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('visual mode previews a project PDF figure with its inline source available', async () => {
  test.setTimeout(90000);
  const parent = join(process.cwd(), 'test-results', 'visual-figures');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const root = join(directory, 'project');
  const userData = join(directory, 'profile');
  await mkdir(join(root, 'figs'), { recursive: true });
  await mkdir(userData);
  await writeFile(join(root, 'figs', 'sample.pdf'), fixturePdf());
  const source = String.raw`\documentclass{article}
\title{Example title}
\author{Example author}
\date{Today}
\begin{document}
Text before.

\begin{figure}
\includegraphics{figs/sample.pdf}
\caption{An example figure}
\end{figure}

\begin{figure}
\includegraphics{figs/sample.pdf}
\caption{A second figure}
\end{figure}

Text after.

\begin{tabular}{lc}
\textbf{One} & $\alpha$ \\
Three \& More & Four \\
\end{tabular}
\end{document}
`;
  await writeFile(join(root, 'main.tex'), source);
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
    await page.getByRole('radio', { name: 'Visual', exact: true }).click();
    const visual = page.getByRole('textbox', { name: 'Visual LaTeX editor', exact: true });
    await expect(visual).toBeVisible();
    await expect(visual.getByText('Title: Example title', { exact: true })).toBeVisible();
    await expect(visual.getByText('Author: Example author', { exact: true })).toBeVisible();
    await expect(visual.getByText('An example figure', { exact: true })).toBeVisible();
    await expect(visual.getByText('A second figure', { exact: true })).toBeVisible();
    await expect(visual.locator('canvas[aria-label="First page of figs/sample.pdf"]')).toHaveCount(
      2,
      { timeout: 30000 },
    );
    const table = visual.getByRole('table', { name: 'Table preview', exact: true });
    await expect(table).toContainText('One');
    await expect(table).toContainText('Four');
    await expect(table.locator('strong')).toHaveText('One');
    await expect(table.locator('.katex')).toHaveCount(1);
    await expect(table).toContainText('Three & More');
    await visual.getByRole('button', { name: 'Edit source: LaTeX source', exact: true }).click();
    const edit = page.locator('.visual-inline-source-host textarea');
    await expect(edit).toHaveValue(/\\includegraphics\{figs\/sample\.pdf\}/);
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
