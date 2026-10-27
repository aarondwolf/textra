import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { Result } from '../../src/shared/api';
import type {
  AIAgentDocument,
  AIAssistantRequest,
  AIAssistantResult,
  AIEditProposal,
  AIAgentReviewRequest,
  AIAgentReviewResult,
} from '../../src/shared/ai';

interface AgentTestState {
  document: AIAgentDocument | null;
  contextId: string;
  generation: number;
  proposal: AIEditProposal | null;
  requests: AIAssistantRequest[];
  cancelled: string[];
  hold: boolean;
  holdReview: boolean;
  limited: boolean;
  linksOpened: string[];
  release: (() => void) | null;
  releaseReview: (() => void) | null;
}

test('native assistant answers, stages active-file edits for review, applies undoably, and rejects stale context', async () => {
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
        cancelled: [],
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
        'textra:ai:assistant:run',
        'textra:ai:assistant:cancel',
        'textra:ai:link',
        'textra:agent:document',
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
            assistant: { provider: 'google', model: 'gemini-3.5-flash-lite' },
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
      ipcMain.handle('textra:ai:assistant:cancel', (_event, request: { requestId: string }) => {
        state.cancelled.push(request.requestId);
        return { ok: true, value: undefined };
      });
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
        'textra:ai:assistant:run',
        (
          event,
          request: AIAssistantRequest,
        ): Result<AIAssistantResult> | Promise<Result<AIAssistantResult>> => {
          state.requests.push(request);
          const send = (value: unknown) => event.sender.send('textra:ai:assistant:event', value);
          if (state.limited) return { ok: false, code: 'AI_RATE_LIMIT', error: 'Quota exceeded' };
          // A failed turn stays pending and merges with the next question; use its last part.
          const latest = request.messages.at(-1)?.text.split('\n\n').at(-1) ?? '';
          // A plain answer: no document access was used or needed.
          if (!request.contextId || /^(Explain|Suggest)/.test(latest)) {
            const text = /^Suggest/.test(latest)
              ? 'Replace Original text. with Revised text. Keep all other source unchanged.'
              : 'Answer only; no edits proposed.';
            send({ requestId: request.requestId, type: 'text', text: text.slice(0, 6) });
            send({ requestId: request.requestId, type: 'text', text });
            return {
              ok: true,
              value: {
                text,
                proposal: null,
                documentAccess: request.contextId ? 'authorized' : 'none',
              },
            };
          }
          if (!state.document || request.contextId !== state.contextId)
            return { ok: false, error: 'The active document changed.' };
          send({
            requestId: request.requestId,
            type: 'status',
            message: 'Reading the active document',
          });
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
          const result: Result<AIAssistantResult> = {
            ok: true,
            value: {
              text: 'Review this proposed correction.',
              proposal,
              documentAccess: 'authorized',
            },
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
    const chat = page.getByRole('region', { name: 'AI assistant', exact: true });
    await expect(chat).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('textra-ai-settings-changed')));
    const modelButton = chat.getByRole('button', { name: /^Model: / });
    const models = page.getByRole('listbox', { name: 'Model', exact: true });
    await expect(modelButton).toHaveAccessibleName('Model: Gemini 3.5 Flash Lite');
    // Chat begins without document access; only an explicit Agent choice authorizes edits.
    await expect(chat.getByRole('button', { name: 'Chat', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(chat.getByRole('button', { name: 'Agent', exact: true })).toBeVisible();
    await expect(chat.locator('.ai-context-chip')).toHaveCount(0);
    await modelButton.click();
    await expect(models.getByRole('option', { name: /Gemini 3.5 Flash Lite/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(models.getByRole('option')).toHaveCount(3);
    await models.getByRole('option', { name: /Gemini 3.8 Flash/ }).click();
    await expect(modelButton).toHaveAccessibleName('Model: Gemini 3.8 Flash');
    const input = chat.getByRole('textbox', { name: 'Message the assistant', exact: true });
    const send = chat.getByRole('button', { name: 'Send message', exact: true });
    await input.fill('Explain this document.');
    await send.click();
    await expect(chat.getByRole('log')).toContainText('Answer only; no edits proposed.');
    const review = page.getByRole('region', { name: 'Review agent changes', exact: true });
    const approveAll = chat.getByRole('button', { name: 'Approve all', exact: true });
    const reject = chat.getByRole('button', { name: 'Reject all', exact: true });
    const editorLines = page.locator('.source-editor .view-lines');
    await chat.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(chat.locator('.ai-context-chip')).toContainText('main.tex');
    await input.fill('Revise the sentence.');
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
    await expect(chat.getByRole('log')).toContainText('Changes rejected');
    await expect(editorLines).toContainText(/Original\s*text\./);
    expect(await readFile(mainFile, 'utf8')).toBe(original);
    await input.fill('Apply a reviewed correction.');
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
    await expect(chat.getByRole('log')).toContainText('Some changes applied');
    await expect(editorLines).toContainText(/Revised\s*text\./);
    await expect(editorLines).toContainText(/Original\s*note\./);
    await expect(editorLines).not.toContainText(/Revised\s*note\./);
    expect(await readFile(mainFile, 'utf8')).toBe(original);

    const editor = page.getByRole('textbox', { name: 'LaTeX source editor', exact: true });
    await editor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(editorLines).toContainText(/Original\s*text\./);
    await input.fill('Approve all changes immediately.');
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
    await input.fill('Hold approval while I change the active file.');
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
    await input.fill('Hold this proposal while I change files.');
    await send.click();
    await expect(chat.getByRole('button', { name: 'Cancel response', exact: true })).toBeVisible();
    await expect(chat.getByRole('log')).toContainText('Reading the active document');
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
    await expect(input).toBeEnabled();
    await expect(review).toHaveCount(0);
    await expect(chat.getByRole('alert')).toContainText('active file changed');
    expect(await readFile(otherFile, 'utf8')).toBe('% Other file must remain unchanged.\n');

    // Without an eligible document the assistant still answers, with no document context.
    await page.getByRole('button', { name: 'File Explorer', exact: true }).click();
    await page.getByRole('button', { name: 'Open notes.md', exact: true }).click();
    await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
    await expect(input).toBeEnabled();
    await expect(chat.locator('.ai-context-chip')).toContainText('No document');
    await chat.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(chat.locator('.ai-context-chip')).toHaveCount(0);
    await input.fill('What does this warning mean?');
    await send.click();
    await expect(chat.getByRole('article', { name: 'Assistant response' }).last()).toContainText(
      'Answer only; no edits proposed.',
    );
    await expect(chat.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'File Explorer', exact: true }).click();
    await page.getByRole('button', { name: 'Open main.tex', exact: true }).click();
    await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
    await application.evaluate(() => {
      (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest.limited = true;
    });
    await chat.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(chat.locator('.ai-context-chip')).toContainText('main.tex');
    await input.fill('Exercise the provider rate limit.');
    await send.click();
    await expect(chat.getByRole('alert')).toContainText('rate or quota limit');
    await chat.getByRole('button', { name: 'View Google Gemini limits', exact: true }).click();
    await application.evaluate(() => {
      (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest.limited = false;
    });
    // The former "Implement Suggested Fix" handoff is an ordinary follow-up instruction.
    await input.fill('Suggest a concrete correction.');
    await send.click();
    await expect(chat.getByRole('log')).toContainText('Replace Original text.');
    await input.fill('Apply that suggested fix.');
    await send.click();
    await expect(review).toBeVisible();
    const state = await application.evaluate(() => {
      const state = (globalThis as typeof globalThis & { agentTest: AgentTestState }).agentTest;
      return { requests: state.requests, linksOpened: state.linksOpened, document: state.document };
    });
    expect(state.linksOpened).toEqual(['google:limits']);
    expect(
      state.requests.every(
        (request) =>
          request.model.provider === 'google' && request.model.model === 'gemini-3.8-flash',
      ),
    ).toBe(true);
    expect(state.requests[0].contextId).toBeUndefined();
    expect(state.requests[1].contextId).toBeTruthy();
    expect(state.requests[0].messages).toEqual([{ role: 'user', text: 'Explain this document.' }]);
    // Review outcomes are application-owned context: a rejected proposal is never "applied".
    expect(state.requests[2].messages[3]).toEqual({
      role: 'model',
      text: 'Review this proposed correction.',
      review: 'rejected',
    });
    expect(state.requests[3].messages.at(-2)).toMatchObject({ review: 'partial' });
    const plain = state.requests.find((request) =>
      request.messages.at(-1)?.text.includes('What does this warning mean?'),
    );
    expect(plain?.contextId).toBeUndefined();
    const handoff = state.requests.at(-1)!;
    expect(handoff.contextId).toBeTruthy();
    expect(handoff.messages.at(-2)).toEqual({
      role: 'model',
      text: 'Replace Original text. with Revised text. Keep all other source unchanged.',
    });
    expect(state.document?.path).toBe('main.tex');
    expect(state.document?.content).toBe(original);
    expect(await readFile(mainFile, 'utf8')).toBe(original);
    await reject.click();
    await expect(review).toHaveCount(0);
    await input.fill('Review a proposal before an external change.');
    await send.click();
    await expect(review).toBeVisible();
    await writeFile(mainFile, `${original}% External edit during review.\n`);
    // The inline conflict banner keeps the editor visible and protected during review.
    await expect(page.locator('.agent-chat-review button').first()).toBeDisabled({
      timeout: 15000,
    });
    await page
      .locator('.conflict-banner')
      .getByRole('button', { name: 'Discard and close tab', exact: true })
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
    await expect(chat.locator('.ai-context-chip')).toContainText('main.tex');
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
            assistant: { provider: 'google', model: 'gemini-3.5-flash-lite' },
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
    const restoredChat = restarted.getByRole('region', { name: 'AI assistant', exact: true });
    await expect(restoredChat).toBeVisible();
    await restarted.evaluate(() => window.dispatchEvent(new Event('textra-ai-settings-changed')));
    // Workspace model choices are temporary; the saved Assistant default returns on restart.
    await expect(restoredChat.getByRole('button', { name: /^Model: / })).toHaveAccessibleName(
      'Model: Gemini 3.5 Flash Lite',
    );
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
