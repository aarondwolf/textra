import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { Result } from '../../src/shared/api';
import type {
  AIAgentDocument,
  AIAgentRequest,
  AIAgentResult,
  AIEditProposal,
  AIAgentReviewRequest,
  AIAgentReviewResult,
} from '../../src/shared/ai';

interface AgentTestState {
  document: AIAgentDocument | null;
  contextId: string;
  generation: number;
  proposal: AIEditProposal | null;
  requests: AIAgentRequest[];
  chatModels: string[];
  hold: boolean;
  holdReview: boolean;
  limited: boolean;
  linksOpened: string[];
  release: (() => void) | null;
  releaseReview: (() => void) | null;
}

test('native agent stages active-file edits for review, applies undoably, and rejects stale context', async () => {
  test.setTimeout(180000);
  const root = join(process.cwd(), 'test-results', 'agent');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'case-'));
  const userData = join(directory, 'user-data');
  const projectRoot = join(directory, 'project');
  await mkdir(userData);
  await mkdir(projectRoot);
  const original =
    '\\documentclass{article}\n\\begin{document}\nOriginal text.\n\\end{document}\n% Original note.\n';
  const mainFile = join(projectRoot, 'main.tex');
  const otherFile = join(projectRoot, 'other.tex');
  await writeFile(mainFile, original);
  await writeFile(otherFile, '% Other file must remain unchanged.\n');
  await writeFile(join(projectRoot, 'notes.md'), '# Notes\nLocal notes.\n');
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  environment.TEXTRA_USER_DATA_DIR = userData;
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NO_SANDBOX;
  delete environment.ELECTRON_CLI_ARGS;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({ args: ['.'], env: environment });
    // Wait for main to finish installing its handlers before replacing provider IPC.
    // Otherwise a cold launch can race handler registration and never create a window.
    const page = await application.firstWindow();
    // Native UI, Monaco, project file IO, and external-change detection are real.
    // Provider and agent lifecycle IPC are explicit mocks; no API key/network is used.
    // The folder chooser and fixed external rate-limit link are also mocked.
    await application.evaluate(({ ipcMain, dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
      const state: AgentTestState = {
        document: null,
        contextId: '',
        generation: 0,
        proposal: null,
        requests: [],
        chatModels: [],
        hold: false,
        holdReview: false,
        limited: false,
        linksOpened: [],
        release: null,
        releaseReview: null,
      };
      (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest = state;
      for (const channel of [
        'textra:ai:settings',
        'textra:ai:send',
        'textra:ai:cancel',
        'textra:ai:link',
        'textra:agent:document',
        'textra:agent:run',
        'textra:agent:accept',
        'textra:agent:review',
        'textra:agent:reject',
      ])
        ipcMain.removeHandler(channel);
      ipcMain.handle('textra:ai:settings', () => ({
        ok: true,
        value: {
          configured: true,
          autoSendProblems: false,
          roleDefaults: {
            chat: { provider: 'google', model: 'gemini-3.5-flash-lite' },
            agent: { provider: 'google', model: 'gemini-3.5-flash-lite' },
            completion: null,
            inlineCompletion: null,
          },
          completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
          providers: ['google', 'openai', 'anthropic', 'ollama-cloud', 'ollama-local'].map(
            (id) => ({
              id,
              configured: id === 'google',
              defaultModel: id === 'google' ? 'gemini-3.5-flash-lite' : null,
              models:
                id === 'google'
                  ? [
                      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
                      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
                      { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
                    ]
                  : [],
              modelsFetchedAt: 1,
              error: null,
            }),
          ),
        },
      }));
      ipcMain.handle(
        'textra:ai:send',
        (_event, request: { model: { provider: string; model: string } }) => {
          state.chatModels.push(`${request.model.provider}:${request.model.model}`);
          return {
            ok: true,
            value:
              state.chatModels.length === 1
                ? 'Chat answer only; no edits proposed.'
                : '**Suggested fix:** Replace Original text. with Revised text. Keep all other source unchanged.',
          };
        },
      );
      ipcMain.handle('textra:ai:cancel', () => ({ ok: true, value: undefined }));
      ipcMain.handle('textra:ai:link', (_event, request: { provider: string; link: string }) => {
        state.linksOpened.push(`${request.provider}:${request.link}`);
        return { ok: true, value: undefined };
      });
      ipcMain.handle('textra:agent:document', (_event, document: AIAgentDocument | null) => {
        if (
          !document !== !state.document ||
          (document &&
            state.document &&
            (['projectId', 'path', 'content', 'revision'] as const).some(
              (key) => document[key] !== state.document?.[key],
            ))
        ) {
          state.document = document;
          state.contextId = `context-${++state.generation}`;
          state.proposal = null;
        }
        return {
          ok: true,
          value: document ? { contextId: state.contextId, path: document.path } : null,
        };
      });
      ipcMain.handle(
        'textra:agent:run',
        (
          _event,
          request: AIAgentRequest,
        ): Result<AIAgentResult> | Promise<Result<AIAgentResult>> => {
          state.requests.push(request);
          if (state.limited) return { ok: false, code: 'AI_RATE_LIMIT', error: 'Quota exceeded' };
          if (!state.document || request.contextId !== state.contextId)
            return { ok: false, error: 'The active document changed.' };
          const proposal: AIEditProposal = {
            ...state.document,
            id: `proposal-${state.requests.length}`,
            contextId: state.contextId,
            modified: state.document.content
              .replace('Original text.', 'Revised text.')
              .replace('% Original note.', '% Revised note.'),
            summary: 'Replace the sentence in the active file.',
          };
          state.proposal = proposal;
          const result: Result<AIAgentResult> = {
            ok: true,
            value: { text: 'Review this proposed correction.', proposal },
          };
          if (state.hold)
            return new Promise((resolve) => {
              state.release = () => resolve(result);
            });
          return result;
        },
      );
      ipcMain.handle(
        'textra:agent:accept',
        (
          _event,
          request: { id: string; contextId: string; hunkIds?: string[] },
        ): Result<AIEditProposal> => {
          const proposal = state.proposal;
          if (
            !proposal ||
            proposal.id !== request.id ||
            proposal.contextId !== request.contextId ||
            request.contextId !== state.contextId
          )
            return { ok: false, error: 'The active document changed. Generate a new proposal.' };
          const ids = request.hunkIds ?? ['hunk-1', 'hunk-2'];
          if (!ids.length || ids.some((id) => id !== 'hunk-1' && id !== 'hunk-2'))
            return { ok: false, error: 'Invalid reviewed changes.' };
          let modified = proposal.content;
          if (ids.includes('hunk-1'))
            modified = modified.replace('Original text.', 'Revised text.');
          if (ids.includes('hunk-2'))
            modified = modified.replace('% Original note.', '% Revised note.');
          state.proposal = null;
          return { ok: true, value: { ...proposal, modified } };
        },
      );
      ipcMain.handle('textra:agent:reject', () => {
        state.proposal = null;
        return { ok: true, value: undefined };
      });
      ipcMain.handle(
        'textra:agent:review',
        (
          _event,
          request: AIAgentReviewRequest,
        ): Result<AIAgentReviewResult> | Promise<Result<AIAgentReviewResult>> => {
          const proposal = state.proposal;
          if (
            !proposal ||
            proposal.id !== request.id ||
            proposal.contextId !== request.contextId ||
            request.contextId !== state.contextId
          )
            return { ok: false, error: 'The active document changed.' };
          // Fixture edits replace independent complete lines, so rebasing is explicit here.
          const before = proposal.content.split('\n');
          const after = proposal.modified.split('\n');
          const changes = before.flatMap((line, index) => (line !== after[index] ? [index] : []));
          const buffer = [...before];
          const target = [...after];
          changes.forEach((line, index) => {
            const id = `hunk-${index + 1}`;
            if (request.approveHunkIds.includes(id)) buffer[line] = after[line];
            if (request.rejectHunkIds.includes(id)) target[line] = before[line];
          });
          const content = buffer.join('\n');
          const modified = target.join('\n');
          const applied = content === proposal.content ? null : { ...proposal, modified: content };
          state.document = {
            projectId: proposal.projectId,
            path: proposal.path,
            revision: proposal.revision,
            content,
          };
          state.contextId = `context-${++state.generation}`;
          const context = { contextId: state.contextId, path: proposal.path };
          const remaining =
            content === modified
              ? null
              : {
                  ...proposal,
                  id: `remaining-${state.generation}`,
                  contextId: context.contextId,
                  content,
                  modified,
                };
          state.proposal = remaining;
          const result: Result<AIAgentReviewResult> = {
            ok: true,
            value: { applied, remaining, context },
          };
          if (state.holdReview)
            return new Promise((resolve) => {
              state.releaseReview = () => resolve(result);
            });
          return result;
        },
      );
    }, projectRoot);
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
    const chat = page.getByRole('region', { name: 'AI debugging chat', exact: true });
    const modelButton = chat.getByRole('button', { name: /^Model: / });
    const models = chat.getByRole('listbox', { name: 'Model', exact: true });
    await expect(modelButton).toHaveAccessibleName('Model: Gemini 3.5 Flash Lite');
    await modelButton.click();
    await expect(models.getByRole('option', { name: /Gemini 3.5 Flash Lite/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(models.getByRole('option')).toHaveCount(3);
    await models.getByRole('option', { name: /Gemini 3.8 Flash/ }).click();
    await expect(modelButton).toHaveAccessibleName('Model: Gemini 3.8 Flash');
    await chat
      .getByRole('textbox', { name: 'Message AI', exact: true })
      .fill('Explain this document.');
    await chat.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(chat.getByRole('log')).toContainText('Chat answer only; no edits proposed.');
    await expect(
      chat.getByRole('button', { name: 'Implement Suggested Fix', exact: true }),
    ).toHaveCount(0);
    await chat.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(chat.locator('.ai-agent-notice')).toBeVisible();
    await expect(chat.locator('.ai-agent-notice')).toHaveCount(0, { timeout: 7500 });
    await expect(chat.getByRole('log')).toContainText('Explain this document.');
    await expect(chat.getByRole('log')).toContainText('Chat answer only; no edits proposed.');
    // Agent keeps its independent saved default.
    await expect(modelButton).toHaveAccessibleName('Model: Gemini 3.5 Flash Lite');
    const agentInput = chat.getByRole('textbox', { name: 'Agent request', exact: true });
    const send = chat.getByRole('button', { name: 'Send message', exact: true });
    const review = page.getByRole('region', { name: 'Review agent changes', exact: true });
    const approveAll = chat.getByRole('button', { name: 'Approve all', exact: true });
    const reject = chat.getByRole('button', { name: 'Reject all', exact: true });
    const editorLines = page.locator('.source-editor .view-lines');
    await agentInput.fill('Revise the sentence.');
    await send.click();
    await expect(review).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Review agent changes', exact: true }),
    ).toHaveCount(0);
    await expect(review.locator('.monaco-diff-editor')).toBeVisible();
    await expect(review.locator('.monaco-editor textarea.inputarea').first()).toHaveJSProperty(
      'readOnly',
      true,
    );
    await expect(editorLines).toContainText(/Original\s*text\./);
    expect(await readFile(mainFile, 'utf8')).toBe(original);
    await page.screenshot({ path: test.info().outputPath('agent-review.png') });
    await reject.click();
    await expect(review).toHaveCount(0);
    await expect(editorLines).toContainText(/Original\s*text\./);
    expect(await readFile(mainFile, 'utf8')).toBe(original);
    await agentInput.fill('Apply a reviewed correction.');
    await send.click();
    await expect(review).toBeVisible();
    await review.getByRole('button', { name: 'Approve change 1', exact: true }).click();
    await expect(editorLines).toContainText(/Revised\s*text\./);
    await expect(
      chat.getByRole('region', { name: 'Agent review controls', exact: true }),
    ).toContainText('1 change remaining');
    await expect(review.getByRole('button', { name: 'Approve change 2', exact: true })).toHaveCount(
      0,
    );
    expect(await readFile(mainFile, 'utf8')).toBe(original);
    await review.getByRole('button', { name: 'Reject change 1', exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(editorLines).toContainText(/Revised\s*text\./);
    await expect(editorLines).toContainText(/Original\s*note\./);
    await expect(editorLines).not.toContainText(/Revised\s*note\./);
    expect(await readFile(mainFile, 'utf8')).toBe(original);

    const editor = page.getByRole('textbox', { name: 'LaTeX source editor', exact: true });
    await editor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(editorLines).toContainText(/Original\s*text\./);
    await agentInput.fill('Approve all changes immediately.');
    await send.click();
    await expect(review).toBeVisible();
    await approveAll.click();
    await expect(review).toHaveCount(0);
    await expect(editorLines).toContainText(/Revised\s*note\./);
    await editor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(editorLines).toContainText(/Original\s*text\./);
    await expect(editorLines).toContainText(/Original\s*note\./);
    expect(await readFile(mainFile, 'utf8')).toBe(original);

    await application.evaluate(() => {
      (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest.holdReview = true;
    });
    await agentInput.fill('Hold approval while I change the active file.');
    await send.click();
    await expect(review).toBeVisible();
    await review.getByRole('button', { name: 'Approve change 1', exact: true }).click();
    await expect(
      review.getByRole('button', { name: 'Approve change 1', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'File Explorer', exact: true }).click();
    await page.getByRole('button', { name: 'Open other.tex', exact: true }).click();
    await application.evaluate(() => {
      const state = (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest;
      state.holdReview = false;
      state.releaseReview?.();
      state.releaseReview = null;
    });
    await expect(review).toHaveCount(0);
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await expect(editorLines).toContainText(/Original\s*text\./);
    await expect(editorLines).not.toContainText(/Revised\s*text\./);
    await page.getByRole('button', { name: 'AI Chat', exact: true }).click();

    await application.evaluate(() => {
      (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest.hold = true;
    });
    await agentInput.fill('Hold this proposal while I change files.');
    await send.click();
    await expect(chat.getByRole('button', { name: 'Cancel response', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'File Explorer', exact: true }).click();
    await page.getByRole('button', { name: 'Open other.tex', exact: true }).click();
    await expect(editorLines).toContainText(/Other\s*file/);
    await expect
      .poll(() =>
        application!.evaluate(
          () =>
            (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest.document
              ?.path,
        ),
      )
      .toBe('other.tex');
    await application.evaluate(() => {
      const state = (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest;
      state.release?.();
      state.release = null;
      state.hold = false;
    });
    await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
    await expect(agentInput).toBeEnabled();
    await expect(review).toHaveCount(0);
    expect(await readFile(otherFile, 'utf8')).toBe('% Other file must remain unchanged.\n');

    await page.getByRole('button', { name: 'File Explorer', exact: true }).click();
    await page.getByRole('button', { name: 'Open notes.md', exact: true }).click();
    await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
    await expect(agentInput).toBeDisabled();
    await expect(send).toBeDisabled();
    await expect(chat).toContainText('Open an active .tex file to use Agent.');
    await page.getByRole('button', { name: 'File Explorer', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
    await application.evaluate(() => {
      (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest.limited = true;
    });
    await agentInput.fill('Exercise the provider rate limit.');
    await send.click();
    await expect(chat.getByRole('alert')).toContainText('rate or Agent budget limit');
    await chat.getByRole('button', { name: 'View Google Gemini limits', exact: true }).click();
    const state = await application.evaluate(() => {
      const state = (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest;
      return {
        requests: state.requests,
        chatModels: state.chatModels,
        linksOpened: state.linksOpened,
      };
    });
    expect(state.chatModels).toEqual(['google:gemini-3.8-flash']);
    expect(state.requests).toHaveLength(6);
    expect(state.requests[0].messages).toEqual([
      { role: 'user', text: 'Explain this document.' },
      { role: 'model', text: 'Chat answer only; no edits proposed.' },
    ]);
    expect(
      state.requests.every(
        (request) =>
          request.model.provider === 'google' && request.model.model === 'gemini-3.5-flash-lite',
      ),
    ).toBe(true);
    expect(state.linksOpened).toEqual(['google:limits']);
    await chat.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(modelButton).toHaveAccessibleName('Model: Gemini 3.8 Flash');
    await expect(chat.getByRole('log')).toContainText('Chat answer only; no edits proposed.');
    await chat.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(modelButton).toHaveAccessibleName('Model: Gemini 3.5 Flash Lite');
    await expect(chat.getByRole('log')).toContainText('Chat answer only; no edits proposed.');
    await application.evaluate(() => {
      (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest.limited = false;
    });
    await chat.getByRole('button', { name: 'Chat', exact: true }).click();
    await chat
      .getByRole('textbox', { name: 'Message AI', exact: true })
      .fill('Suggest a concrete correction.');
    await send.click();
    const implement = chat.getByRole('button', { name: 'Implement Suggested Fix', exact: true });
    await expect(implement).toBeEnabled();
    await implement.click();
    await expect(review).toBeVisible();
    await expect(chat.getByRole('button', { name: 'Agent', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const handoff = await application.evaluate(() => {
      const state = (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest;
      return { request: state.requests.at(-1), document: state.document };
    });
    expect(handoff.request?.prompt).toBe('Implement the suggested fix above.');
    expect(handoff.request?.model).toEqual({ provider: 'google', model: 'gemini-3.5-flash-lite' });
    expect(handoff.request?.messages?.at(-1)).toEqual({
      role: 'model',
      text: '**Suggested fix:** Replace Original text. with Revised text. Keep all other source unchanged.',
    });
    expect(handoff.document?.path).toBe('main.tex');
    expect(handoff.document?.content).toBe(original);
    expect(await readFile(mainFile, 'utf8')).toBe(original);
    await reject.click();
    await expect(review).toHaveCount(0);
    await expect(chat.locator('.ai-agent-notice')).toHaveCount(0);
    await agentInput.fill('Review a proposal before an external change.');
    await send.click();
    await expect(review).toBeVisible();
    await writeFile(mainFile, `${original}% External edit during review.\n`);
    // The existing external-change modal hides the rest of the app from the
    // accessibility tree. Inspect the underlying disabled control, then resolve
    // that modal without writing over the external file before rejecting.
    await expect(page.locator('.agent-chat-review button').first()).toBeDisabled({
      timeout: 15000,
    });
    await page
      .getByRole('dialog', { name: 'External change detected', exact: true })
      .getByRole('button', { name: 'Close TeXtra buffer', exact: true })
      .click();
    await reject.click();
    await expect(review).toHaveCount(0);
    expect(await readFile(mainFile, 'utf8')).toBe(`${original}% External edit during review.\n`);
    expect(await readFile(otherFile, 'utf8')).toBe('% Other file must remain unchanged.\n');

    const secondProject = join(directory, 'second-project');
    await mkdir(secondProject);
    await writeFile(join(secondProject, 'main.tex'), original);
    await application.evaluate(({ dialog }, selectedRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedRoot] });
    }, secondProject);
    await page.getByRole('button', { name: 'File Explorer', exact: true }).click();
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
    await expect(chat.locator('.ai-agent-notice')).toHaveCount(0);
    await application.close();
    application = await electron.launch({ args: ['.'], env: environment });
    // Windows may still release Chromium profile handles after the first process exits.
    const restarted = await application.firstWindow({ timeout: 60000 });
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('textra:ai:settings');
      ipcMain.handle('textra:ai:settings', () => ({
        ok: true,
        value: {
          configured: true,
          autoSendProblems: false,
          roleDefaults: {
            chat: { provider: 'google', model: 'gemini-3.5-flash-lite' },
            agent: { provider: 'google', model: 'gemini-3.5-flash-lite' },
            completion: null,
            inlineCompletion: null,
          },
          completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
          providers: ['google', 'openai', 'anthropic', 'ollama-cloud', 'ollama-local'].map(
            (id) => ({
              id,
              configured: id === 'google',
              defaultModel: id === 'google' ? 'gemini-3.5-flash-lite' : null,
              models:
                id === 'google'
                  ? [
                      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
                      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
                      { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
                    ]
                  : [],
              modelsFetchedAt: 1,
              error: null,
            }),
          ),
        },
      }));
    });
    await restarted.getByRole('button', { name: 'AI Chat', exact: true }).click();
    const restoredChat = restarted.getByRole('region', { name: 'AI debugging chat', exact: true });
    await expect(restoredChat.getByRole('button', { name: /^Model: / })).toHaveAccessibleName(
      'Model: Gemini 3.5 Flash Lite',
    );
    await restoredChat.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(restoredChat.getByRole('button', { name: /^Model: / })).toHaveAccessibleName(
      'Model: Gemini 3.5 Flash Lite',
    );
    await expect(restoredChat.locator('.ai-agent-notice')).toHaveCount(0);
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
