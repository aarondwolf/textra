import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('real Electron denies other windows, coalesces close and saves pending preferences', async () => {
  test.setTimeout(120_000);
  const base = join(process.cwd(), 'test-results', 'lifecycle');
  await mkdir(base, { recursive: true });
  const profile = await mkdtemp(join(base, 'profile-'));
  const project = join(profile, 'project');
  await mkdir(project);
  await writeFile(
    join(project, 'main.tex'),
    '\\documentclass{article}\n\\begin{document}\nFixture.\n\\end{document}\n',
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = profile;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NO_SANDBOX;
  delete env.ELECTRON_CLI_ARGS;
  const application = await electron.launch({ args: ['.'], env });
  let closed = false;
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole('main', { name: 'Document workspace' })).toBeVisible();
    const denied = await application.evaluate(
      async ({ BrowserWindow }, preload) => {
        const trusted = BrowserWindow.getAllWindows()[0];
        const other = new BrowserWindow({
          show: false,
          webPreferences: {
            preload,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
          },
        });
        try {
          await other.loadURL(trusted.webContents.getURL());
          return await other.webContents.executeJavaScript('window.textra.getAppInfo()');
        } finally {
          other.destroy();
        }
      },
      join(process.cwd(), 'out', 'preload', 'index.cjs'),
    );
    expect(denied).toMatchObject({ ok: false });
    await page.evaluate(() => {
      window.open('https://example.invalid/');
    });
    await expect
      .poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(1);

    const executable = await application.evaluate(({ app }) => app.getPath('exe'));
    const secondary = spawn(executable, ['.'], { env, windowsHide: true, stdio: 'ignore' });
    const secondExit = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        secondary.kill();
        reject(Error('Second instance did not exit.'));
      }, 15_000);
      secondary.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      secondary.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(secondExit).toBe(0);
    expect(
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    ).toBe(1);

    // A cancelled close must leave the application usable, with one native prompt.
    await application.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & { closePromptCount?: number };
      state.closePromptCount = 0;
      dialog.showMessageBox = async () => {
        state.closePromptCount = (state.closePromptCount ?? 0) + 1;
        return { response: 0, checkboxChecked: false };
      };
    });
    await application.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, project);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await page.getByTestId('source-editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\n% unsaved fixture');
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.close();
      window.close();
    });
    await expect
      .poll(() =>
        application.evaluate(
          () => (globalThis as typeof globalThis & { closePromptCount?: number }).closePromptCount,
        ),
      )
      .toBe(1);
    await expect(page.getByRole('main', { name: 'Document workspace' })).toBeVisible();
    await expect(page.getByRole('main', { name: 'Document workspace' })).not.toHaveAttribute(
      'inert',
      '',
    );
    await page.keyboard.press('Control+s');
    await expect
      .poll(() => readFile(join(project, 'main.tex'), 'utf8'))
      .toContain('% unsaved fixture');

    // Toggle and close within the 250ms renderer debounce; close must flush the final value.
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Toggle sidebar"]')?.click();
    });
    await application.close();
    closed = true;
    const preferences = JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8')) as {
      sidebarVisible: boolean;
    };
    expect(preferences.sidebarVisible).toBe(false);
  } finally {
    if (!closed) {
      await application
        .evaluate(({ app }) => {
          setImmediate(() => app.exit(0));
        })
        .catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test('renderer crash requires explicit native consent before draining and closing', async () => {
  test.setTimeout(60_000);
  const base = join(process.cwd(), 'test-results', 'crashed-renderer');
  await mkdir(base, { recursive: true });
  const profile = await mkdtemp(join(base, 'profile-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = profile;
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({ args: ['.'], env });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole('main', { name: 'Document workspace' })).toBeVisible();
    await application.evaluate(({ BrowserWindow, dialog }) => {
      const state = globalThis as typeof globalThis & { crashCloseQuestions?: number };
      state.crashCloseQuestions = 0;
      dialog.showMessageBox = async (...args: unknown[]) => {
        const options = args.at(-1) as { title?: string };
        if (options.title === 'Close TeXtra after renderer failure?') {
          state.crashCloseQuestions = (state.crashCloseQuestions ?? 0) + 1;
          return { response: 0, checkboxChecked: false };
        }
        return { response: 0, checkboxChecked: false };
      };
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.once('render-process-gone', () => window.close());
      window.webContents.forcefullyCrashRenderer();
    });
    await expect
      .poll(() =>
        application.evaluate(
          () =>
            (globalThis as typeof globalThis & { crashCloseQuestions?: number })
              .crashCloseQuestions,
        ),
      )
      .toBe(1);
    expect(
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    ).toBe(1);
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    await application.close();
  } finally {
    await application
      .evaluate(({ app }) => {
        setImmediate(() => app.exit(0));
      })
      .catch(() => undefined);
    await application.close().catch(() => undefined);
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
