import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { AISettings, Result } from '../../src/shared/api';
import type { AICompletionRequest, AICompletionResponse } from '../../src/shared/ai';

interface CompletionTestState {
  settings: AISettings;
  requests: AICompletionRequest[];
  cancelled: string[];
  hold: boolean;
  release: (() => void) | null;
}

test('native AI completion is opt-in, continues prose on Ctrl+I, and accepts undoably', async () => {
  test.setTimeout(120000);
  const root = join(process.cwd(), 'test-results', 'completion');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'case-'));
  const projectRoot = join(directory, 'project');
  const userData = join(directory, 'user-data');
  await mkdir(projectRoot);
  await mkdir(userData);
  await writeFile(
    join(projectRoot, 'main.tex'),
    [
      '\\documentclass{article}',
      '\\begin{document}',
      'Plain prose.',
      '\\begin{equation}',
      'x',
      '\\end{equation}',
      '\\begin{lstlisting}[language=Python]',
      'print(1)',
      '\\end{lstlisting}',
      '\\end{document}',
    ].join('\n'),
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NO_SANDBOX;
  delete env.ELECTRON_CLI_ARGS;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env });
    const page = await application.firstWindow();
    // Native UI, Monaco and project IO are real. AI and the folder chooser are
    // explicit mocks; no provider connection or credentials are used.
    await application.evaluate(({ ipcMain, dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
      const model = { provider: 'ollama-local' as const, model: 'fixture-code' };
      const state: CompletionTestState = {
        settings: {
          configured: true,
          autoSendProblems: false,
          roleDefaults: { chat: null, agent: null, completion: model, inlineCompletion: model },
          completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
          providers: [
            {
              id: 'ollama-local',
              configured: true,
              defaultModel: 'fixture-code',
              modelsFetchedAt: 1,
              error: null,
              models: [
                {
                  id: 'fixture-code',
                  label: 'Fixture Code',
                  capabilities: { chat: false, completion: true, transport: 'ollama-generate' },
                },
              ],
            },
          ],
        },
        requests: [],
        cancelled: [],
        hold: false,
        release: null,
      };
      (globalThis as typeof globalThis & { completionTest: CompletionTestState }).completionTest =
        state;
      for (const channel of [
        'textra:ai:settings',
        'textra:ai:completion:settings',
        'textra:ai:completion:request',
        'textra:ai:completion:cancel',
      ])
        ipcMain.removeHandler(channel);
      ipcMain.handle('textra:ai:settings', () => ({ ok: true, value: state.settings }));
      ipcMain.handle(
        'textra:ai:completion:settings',
        (_event, request: { enabled: boolean; allowOutsideEnvironments: boolean }) => {
          state.settings.completion = {
            ...request,
            consentedModel: request.enabled ? model : null,
          };
          return { ok: true, value: state.settings };
        },
      );
      ipcMain.handle(
        'textra:ai:completion:request',
        (
          _event,
          request: AICompletionRequest,
        ): Result<AICompletionResponse> | Promise<Result<AICompletionResponse>> => {
          state.requests.push(request);
          const reply = {
            ok: true as const,
            value: {
              requestId: request.requestId,
              modelVersion: request.modelVersion,
              offset: request.offset,
              text: state.hold
                ? 'STALE_RESPONSE'
                : request.role === 'inlineCompletion'
                  ? ' MANUAL_CONTINUATION'
                  : ' AUTO_CONTINUATION',
            },
          };
          if (!state.hold) return reply;
          return new Promise((resolve) => {
            state.release = () => resolve(reply);
          });
        },
      );
      ipcMain.handle('textra:ai:completion:cancel', (_event, request: { requestId: string }) => {
        state.cancelled.push(request.requestId);
        return { ok: true, value: undefined };
      });
    }, projectRoot);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'LaTeX source editor', exact: true });
    const source = page.locator('.source-editor .view-lines');
    const manual = page.locator('[aria-label="Inline AI completion"]');
    const automatic = page.locator('[aria-label="Automatic AI completion"]');
    const count = () =>
      application!.evaluate(
        () =>
          (globalThis as typeof globalThis & { completionTest: CompletionTestState }).completionTest
            .requests.length,
      );
    const go = async (line: number) => {
      await editor.focus();
      await page.keyboard.press('Control+Home');
      for (let index = 1; index < line; index++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('End');
    };
    await go(5);
    await page.keyboard.insertText(' + ');
    await page.waitForTimeout(1200); // Exceeds the automatic debounce while opt-in is off.
    expect(await count()).toBe(0);
    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'AI Chat', exact: true }).click();
    await settings.getByRole('button', { name: 'Configure AI providers…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'AI settings', exact: true });
    const enabled = dialog.getByRole('checkbox', { name: /^Enable automatic completion/ });
    await expect(enabled).not.toBeChecked();
    await expect(
      dialog.getByRole('checkbox', { name: /^Allow automatic completion outside/ }),
    ).not.toBeChecked();
    await enabled.check();
    await expect(enabled).toBeChecked();
    await dialog.getByRole('button', { name: 'Close AI settings', exact: true }).click();
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await go(3);
    await page.keyboard.insertText(' prose');
    await page.waitForTimeout(1200); // Plain prose remains quiet with automatic completion enabled.
    expect(await count()).toBe(0);
    await editor.focus();
    await page.keyboard.press('Control+i');
    await expect(manual.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
    await expect(
      manual.getByRole('button', { name: /^Ctrl\+I completion model: Fixture Code/ }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('manual-ghost-text.png') });
    await page.keyboard.press('Tab');
    await expect(manual).toHaveCount(0);
    await expect(source).toContainText('MANUAL_CONTINUATION');
    await page.keyboard.press('Control+z');
    await expect(source).not.toContainText('MANUAL_CONTINUATION');

    await go(3);
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await page.keyboard.press('Control+i');
    await expect(manual.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
    const selectedRequest = await application.evaluate(() =>
      (
        globalThis as typeof globalThis & { completionTest: CompletionTestState }
      ).completionTest.requests.at(-1),
    );
    expect(selectedRequest?.prefix).toMatch(/ prose$/);
    await page.keyboard.press('Tab');
    await expect(source).toContainText(/prose\s+MANUAL_CONTINUATION/);
    await page.keyboard.press('Control+z');
    await expect(source).not.toContainText('MANUAL_CONTINUATION');

    await application.evaluate(() => {
      (
        globalThis as typeof globalThis & { completionTest: CompletionTestState }
      ).completionTest.hold = true;
    });
    await go(3);
    await page.keyboard.insertText('!'); // Distinct context avoids the earlier completion cache.
    const previous = await count();
    await page.keyboard.press('Control+i');
    await expect.poll(count).toBe(previous + 1);
    await page.keyboard.insertText('?');
    await application.evaluate(() => {
      const state = (globalThis as typeof globalThis & { completionTest: CompletionTestState })
        .completionTest;
      state.release?.();
      state.hold = false;
    });
    await expect(source).not.toContainText('STALE_RESPONSE');
    await expect(manual).toHaveCount(0);
    expect(
      await application.evaluate(
        () =>
          (globalThis as typeof globalThis & { completionTest: CompletionTestState }).completionTest
            .cancelled.length,
      ),
    ).toBeGreaterThan(0);

    await go(5);
    const beforeEquation = await count();
    await page.keyboard.insertText('+ ');
    await expect(automatic.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
    expect(await count()).toBe(beforeEquation + 1);
    await page.keyboard.press('Tab');
    await expect(source).toContainText('AUTO_CONTINUATION');
    await page.keyboard.press('Control+z');
    await expect(source).not.toContainText('AUTO_CONTINUATION');
    await page.waitForTimeout(2200); // Respect the automatic request rate bound.
    await go(8);
    await page.keyboard.insertText(' ');
    await expect(automatic.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
    const literal = await application.evaluate(() =>
      (
        globalThis as typeof globalThis & { completionTest: CompletionTestState }
      ).completionTest.requests.at(-1),
    );
    expect(literal?.role).toBe('completion');
    expect(JSON.parse(literal!.metadata)).toMatchObject({ literal: true, language: 'Python' });
    await page.screenshot({ path: test.info().outputPath('literal-ghost-text.png') });
    await page.keyboard.press('Escape');
    await expect(automatic).toHaveCount(0);
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
