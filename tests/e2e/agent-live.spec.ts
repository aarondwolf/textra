import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('opt-in live Gemini 3.5 Flash Lite stages both lipsum edits and reviews them sequentially', async () => {
  test.skip(
    process.env.TEXTRA_LIVE_AI_TEST !== '1',
    'Explicit opt-in uses the saved OS-encrypted Google key and real quota.',
  );
  test.setTimeout(120000);
  const parent = join(process.cwd(), 'test-results', 'agent-live');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const projectRoot = join(directory, 'project');
  await mkdir(projectRoot);
  const userData = join(directory, 'user-data');
  await mkdir(userData);
  if (process.platform === 'win32' && process.env.APPDATA) {
    // Isolate UI state while retaining the same OS-encrypted Chromium key. Never
    // decrypt/print credentials or copy cookies, history, or the rest of the profile.
    const state: unknown = JSON.parse(
      await readFile(join(process.env.APPDATA, 'TeXtra', 'Local State'), 'utf8'),
    );
    if (state && typeof state === 'object' && 'os_crypt' in state)
      await writeFile(join(userData, 'Local State'), JSON.stringify({ os_crypt: state.os_crypt }));
  }
  const original = [
    '\\documentclass{article}',
    '\\usepackage{amsmath}',
    '\\begin{document}',
    ...Array.from({ length: 24 }, (_, index) => `% Filler ${index + 1}`),
    'Lorem ipsum dolor sit amet.',
    '\\end{document}',
    '',
  ].join('\n');
  const file = join(projectRoot, 'main.tex');
  await writeFile(file, original);
  const environment: Record<string, string> = {
    TEXTRA_USER_DATA_DIR: userData,
  };
  for (const [name, value] of Object.entries(process.env))
    if (value !== undefined) environment[name] = value;
  delete environment.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env: environment });
  try {
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
    }, projectRoot);
    const page = await app.firstWindow();
    await page
      .getByRole('button', { name: 'Open folder', exact: true })
      .waitFor({ state: 'visible' });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const result = await page.evaluate(async () => {
      const selected = await window.textra.chooseProject();
      if (!selected.ok) return selected;
      if (!selected.value) return { ok: false, error: 'No fixture selected.' };
      const file = await window.textra.readFile({ projectId: selected.value.id, path: 'main.tex' });
      if (!file.ok) return file;
      const context = await window.textra.syncAIAgentDocument(file.value);
      if (!context.ok) return context;
      if (!context.value) return { ok: false, error: 'No active tex context.' };
      const proposed = await window.textra.runAIAssistant({
        contextId: context.value.contextId,
        messages: [
          {
            role: 'user',
            text: 'Add the lipsum package to the preamble and replace the current line 28 (Lorem ipsum dolor sit amet.) with \\lipsum[1-4]. Complete BOTH requested edits in one proposal. Make no other changes.',
          },
        ],
        model: { provider: 'google', model: 'gemini-3.5-flash-lite' },
        requestId: crypto.randomUUID(),
      });
      if (!proposed.ok) return { ...proposed, phase: 'run' };
      if (!proposed.value.proposal)
        return { ok: false, error: 'The model proposed no text change.' };
      const accepted = await window.textra.reviewAIAgentProposal({
        id: proposed.value.proposal.id,
        contextId: context.value.contextId,
        approveHunkIds: ['hunk-1'],
        rejectHunkIds: [],
      });
      if (!accepted.ok) return { ...accepted, phase: 'accept' };
      const first = accepted.value.applied;
      const remaining = accepted.value.remaining;
      if (!first || !remaining)
        return { ok: false, error: 'The two-part task did not produce two reviewable changes.' };
      const echoed = await window.textra.syncAIAgentDocument({
        projectId: first.projectId,
        path: first.path,
        content: first.modified,
        revision: first.revision,
      });
      if (!echoed.ok) return echoed;
      if (echoed.value?.contextId !== accepted.value.context.contextId)
        return { ok: false, error: 'Approval did not preserve the rebased review context.' };
      const last = await window.textra.reviewAIAgentProposal({
        id: remaining.id,
        contextId: remaining.contextId,
        approveHunkIds: ['hunk-1'],
        rejectHunkIds: [],
      });
      if (!last.ok) return { ...last, phase: 'last-approval' };
      return {
        ok: true,
        first: first.modified,
        modified: last.value.applied?.modified,
        remaining: last.value.remaining,
      };
    });
    if (!result.ok || !('modified' in result)) throw new Error(JSON.stringify(result));
    expect(result.first).toContain('\\usepackage{lipsum}');
    expect(result.first).toContain('Lorem ipsum dolor sit amet.');
    expect(result.modified).toContain('\\usepackage{lipsum}');
    expect(result.modified).toContain('\\lipsum[1-4]');
    expect(result.modified).not.toContain('Lorem ipsum dolor sit amet.');
    expect(result.remaining).toBeNull();
    expect(await readFile(file, 'utf8')).toBe(original);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await app.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
