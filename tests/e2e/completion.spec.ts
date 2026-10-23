import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { AISettings, Result } from '../../src/shared/api';
import type {
  AICompletionRequest,
  AICompletionResponse,
  AIInlineEditRequest,
  AIInlineEditResponse,
} from '../../src/shared/ai';

interface CompletionTestState {
  settings: AISettings;
  requests: AICompletionRequest[];
  edits: AIInlineEditRequest[];
  cancelled: string[];
  compiles: number;
  hold: boolean;
  release: (() => void) | null;
}

test('native prompted inline edits, quiet automatic ghost text, and compile shortcut', async () => {
  test.setTimeout(150000);
  const root = join(process.cwd(), 'test-results', 'completion');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'case-'));
  const projectRoot = join(directory, 'project');
  await mkdir(projectRoot);
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
  const env: Record<string, string> = { TEXTRA_USER_DATA_DIR: join(directory, 'user-data') };
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NO_SANDBOX;
  delete env.ELECTRON_CLI_ARGS;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env });
    const page = await application.firstWindow();
    // Real native editor/project IO. Only AI, build execution and folder selection
    // are mocked; no credentials or external providers are used.
    await application.evaluate(({ ipcMain, dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
      const model = { provider: 'ollama-local' as const, model: 'fixture-code' };
      const state: CompletionTestState = {
        settings: {
          configured: true,
          autoSendProblems: false,
          roleDefaults: { assistant: model, completion: model, inlineCompletion: model },
          completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
          providers: [
            {
              id: 'ollama-local',
              configured: true,
              enabled: true,
              defaultModel: model.model,
              modelsFetchedAt: 1,
              error: null,
              models: [
                {
                  id: model.model,
                  label: 'Fixture Code',
                  capabilities: { chat: true, completion: true, transport: 'ollama-generate' },
                },
              ],
            },
          ],
        },
        requests: [],
        edits: [],
        cancelled: [],
        compiles: 0,
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
        'textra:ai:inline-edit:request',
        'textra:ai:inline-edit:cancel',
        'textra:build:compile',
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
        (_event, request: AICompletionRequest): Result<AICompletionResponse> => {
          state.requests.push(request);
          return {
            ok: true,
            value: {
              requestId: request.requestId,
              modelVersion: request.modelVersion,
              offset: request.offset,
              text: ' AUTO_CONTINUATION\nSECOND_LINE\nTHIRD_LINE',
            },
          };
        },
      );
      ipcMain.handle(
        'textra:ai:inline-edit:request',
        (
          event,
          request: AIInlineEditRequest,
        ): Result<AIInlineEditResponse> | Promise<Result<AIInlineEditResponse>> => {
          state.edits.push(request);
          const reply = {
            ok: true as const,
            value: {
              requestId: request.requestId,
              modelVersion: request.modelVersion,
              offset: request.offset,
              endOffset: request.endOffset,
              text: state.hold
                ? 'STALE_RESPONSE'
                : request.selection
                  ? 'REWRITTEN_SELECTION'
                  : ' MANUAL_INSERTION',
            },
          };
          if (request.selection && !state.hold) {
            // Stream a growing preview, then complete only when the test releases it.
            event.sender.send('textra:ai:inline-edit:chunk', {
              requestId: request.requestId,
              text: 'REWRI',
            });
            return new Promise((resolve) => {
              state.release = () => resolve(reply);
            });
          }
          if (!state.hold) return reply;
          return new Promise((resolve) => {
            state.release = () => resolve(reply);
          });
        },
      );
      for (const channel of ['textra:ai:completion:cancel', 'textra:ai:inline-edit:cancel'])
        ipcMain.handle(channel, (_event, request: { requestId: string }) => {
          state.cancelled.push(request.requestId);
          return { ok: true, value: undefined };
        });
      ipcMain.handle('textra:build:compile', () => {
        state.compiles++;
        return {
          ok: true,
          value: {
            running: false,
            outcome: 'success',
            log: 'Mock build invoked',
            diagnostics: [],
            pdfPath: null,
            projectId: null,
            rootFile: null,
          },
        };
      });
    }, projectRoot);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    const editor = page.getByRole('textbox', { name: 'LaTeX source editor', exact: true });
    await expect(editor).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('textra-ai-settings-changed')));
    const source = page.locator('.source-editor .view-lines');
    const panel = page.locator('[aria-label="Inline AI edit"]');
    const prompt = page.getByRole('textbox', { name: 'Inline edit instruction', exact: true });
    const state = () =>
      application!.evaluate(() => {
        const s = (globalThis as typeof globalThis & { completionTest: CompletionTestState })
          .completionTest;
        return {
          requests: s.requests,
          edits: s.edits,
          cancelled: s.cancelled,
          compiles: s.compiles,
        };
      });
    const go = async (line: number) => {
      await editor.focus();
      await page.keyboard.press('Control+Home');
      for (let i = 1; i < line; i++) await page.keyboard.press('ArrowDown');
      await page.keyboard.press('End');
    };
    await go(5);
    await page.keyboard.insertText(' + ');
    await page.waitForTimeout(1200);
    expect((await state()).requests).toHaveLength(0);
    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'AI Settings', exact: true }).click();
    const aiSettings = settings.locator('.ai-settings-inline');
    await expect(aiSettings).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('textra-ai-settings-changed')));
    const enabled = aiSettings.getByRole('checkbox', { name: /^Enable automatic completion/ });
    await expect(enabled).not.toBeChecked();
    await expect(
      aiSettings.getByRole('button', { name: /^Automatic completion.*model:/ }),
    ).toHaveCount(0);
    // Controlled by saved settings: the checkbox changes once the save completes.
    await enabled.click();
    await expect(enabled).toBeChecked();
    await expect(aiSettings).toContainText('math');
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
    await go(3);
    await page.keyboard.insertText(' prose Th');
    await page.waitForTimeout(1200);
    expect((await state()).requests).toHaveLength(0);
    await expect(page.locator('.suggest-widget.visible')).toHaveCount(0);

    await page.keyboard.press('Control+i');
    await expect(prompt).toBeFocused();
    expect((await state()).edits).toHaveLength(0); // Opening never sends.
    await prompt.fill('Insert a sentence');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.insertText('Keep it concise.');
    await expect(prompt).toHaveValue('Insert a sentence\nKeep it concise.');
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('button', { name: 'Accept', exact: true })).toBeVisible();
    expect((await state()).edits[0]).toMatchObject({
      instruction: 'Insert a sentence\nKeep it concise.',
      selection: '',
    });
    await page.screenshot({ path: test.info().outputPath('prompted-inline-insertion.png') });
    await editor.focus();
    await page.keyboard.press('Tab');
    await expect(panel).toHaveCount(0);
    await expect(source).toContainText('MANUAL_INSERTION');
    await page.keyboard.press('Control+z');
    await expect(source).not.toContainText('MANUAL_INSERTION');

    await go(3);
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await page.keyboard.press('Control+i');
    await expect(prompt).toBeFocused();
    await prompt.fill('Rewrite the selection');
    await page.keyboard.press('Enter');
    const preview = panel.locator('[aria-label="Inline edit preview"]');
    await expect(preview.locator('del')).toHaveText('Th');
    // The replacement preview grows while streaming; acceptance waits for completion.
    await expect(preview.locator('ins')).toHaveText('REWRI');
    await expect(panel.getByRole('button', { name: 'Accept', exact: true })).toBeDisabled();
    await application.evaluate(() => {
      const s = (globalThis as typeof globalThis & { completionTest: CompletionTestState })
        .completionTest;
      s.release?.();
      s.release = null;
    });
    await expect(preview.locator('ins')).toHaveText('REWRITTEN_SELECTION');
    await expect(panel.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('prompted-selection-diff.png') });
    await panel.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(source).toContainText('REWRITTEN_SELECTION');
    await page.keyboard.press('Control+z');
    await expect(source).not.toContainText('REWRITTEN_SELECTION');
    await expect(source).toContainText(/prose\s+Th/);

    await application.evaluate(() => {
      (
        globalThis as typeof globalThis & { completionTest: CompletionTestState }
      ).completionTest.hold = true;
    });
    await go(3);
    await page.keyboard.press('Control+i');
    await prompt.fill('Delayed insertion');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state()).edits.length).toBe(3);
    await editor.focus();
    await page.keyboard.insertText('?');
    await application.evaluate(() => {
      const s = (globalThis as typeof globalThis & { completionTest: CompletionTestState })
        .completionTest;
      s.release?.();
      s.hold = false;
    });
    await expect(panel).toHaveCount(0);
    await expect(source).not.toContainText('STALE_RESPONSE');
    expect((await state()).cancelled.length).toBeGreaterThan(0);

    await go(5);
    const before = (await state()).requests.length;
    await page.keyboard.insertText('+ ');
    await expect.poll(async () => (await state()).requests.length).toBe(before + 1);
    await expect(page.locator('.ghost-text')).not.toHaveCount(0);
    await expect(page.locator('.ai-completion-toolbar')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(source).toContainText('THIRD_LINE');
    await page.keyboard.press('Control+z');
    await expect(source).not.toContainText('THIRD_LINE');
    await page.waitForTimeout(2200);
    await go(8);
    await page.keyboard.insertText(' ');
    await expect.poll(async () => (await state()).requests.length).toBe(before + 2);
    expect(JSON.parse((await state()).requests.at(-1)!.metadata)).toMatchObject({
      literal: true,
      language: 'Python',
    });
    await expect(page.locator('.ghost-text')).not.toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.ghost-text')).toHaveCount(0);

    await go(3);
    const sourceBefore = await source.textContent();
    await page.keyboard.press('Control+Enter');
    await expect.poll(async () => (await state()).compiles).toBe(1);
    await expect(source).toHaveText(sourceBefore!);
    await page.waitForTimeout(300);
    expect((await state()).compiles).toBe(1);
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
