// Explicit opt-in, billable live-provider smoke test. Never changes keys or pulls models.
// Run after a production build, with no concurrent native tests:
//   node tests/manual/ai-completion-live.mjs --run
import { _electron as electron } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

if (!process.argv.includes('--run')) {
  console.log('Live AI completion is opt-in. Add --run to use already configured providers.');
  process.exit(0);
}
const root = join(process.cwd(), '.test-data', 'completion-live');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, 'case-'));
const project = join(directory, 'project');
await mkdir(project);
const source =
  '\\documentclass{article}\n\\begin{document}\nThe Pythagorean theorem states that \n\\begin{lstlisting}[language=Python]\ndef add(a, b):\n    return \n\\end{lstlisting}\n\\end{document}\n';
await writeFile(join(project, 'main.tex'), source);
const env = { ...process.env, TEXTRA_USER_DATA_DIR: join(directory, 'user-data') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NO_SANDBOX;
delete env.ELECTRON_CLI_ARGS;
let application;
try {
  application = await electron.launch({ args: ['.'], env });
  const page = await application.firstWindow();
  await page.waitForFunction(() => Boolean(window.textra));
  // Only folder selection is replaced. AI settings, encrypted keys, networking,
  // scope validation, transport selection and cancellation use the real app.
  await application.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, project);
  const selectedProvider = process.argv
    .find((value) => value.startsWith('--provider='))
    ?.split('=')[1];
  const report = await page.evaluate(async (selectedProvider) => {
    const bridge = window.textra;
    const opened = await bridge.chooseProject();
    if (!opened.ok || !opened.value)
      throw new Error('Could not authorize synthetic fixture project.');
    const snapshot = await bridge.readFile({ projectId: opened.value.id, path: 'main.tex' });
    if (!snapshot.ok) throw new Error(snapshot.error);
    let loaded = await bridge.getAISettings();
    if (!loaded.ok) throw new Error(loaded.error);
    const evidence = [];
    for (const id of ['ollama-local', 'codestral', 'google']) {
      if (selectedProvider && id !== selectedProvider) continue;
      let provider = loaded.value.providers.find((item) => item.id === id);
      if (!provider?.configured) {
        evidence.push({ provider: id, outcome: 'unconfigured — not tested live' });
        continue;
      }
      const refreshed = await bridge.refreshAIModels({ provider: id });
      if (!refreshed.ok) {
        evidence.push({
          provider: id,
          outcome: 'catalogue refresh failed',
          error: refreshed.error,
        });
        continue;
      }
      loaded = refreshed;
      provider = loaded.value.providers.find((item) => item.id === id);
      const models = provider.models.filter((item) => item.capabilities?.completion !== false);
      const model =
        id === 'ollama-local'
          ? models.find((item) => /^qwen2\.5-coder:3b$/i.test(item.id))
          : id === 'codestral'
            ? (models.find(
                (item) =>
                  item.id === provider.defaultModel &&
                  item.capabilities?.transport === 'mistral-fim',
              ) ?? models.find((item) => item.capabilities?.transport === 'mistral-fim'))
            : (models.find(
                (item) => item.id === provider.defaultModel && item.capabilities?.chat !== false,
              ) ?? models.find((item) => item.capabilities?.chat !== false));
      if (!model) {
        evidence.push({ provider: id, outcome: 'no eligible configured model — not tested live' });
        continue;
      }
      const code = id !== 'google';
      const offset = code
        ? snapshot.value.content.indexOf('    return ') + '    return '.length
        : snapshot.value.content.indexOf('\n\\begin{lstlisting}');
      const request = {
        requestId: crypto.randomUUID(),
        role: 'inlineCompletion',
        model: { provider: id, model: model.id },
        projectId: opened.value.id,
        path: 'main.tex',
        revision: snapshot.value.revision,
        modelVersion: 1,
        offset,
        prefix: snapshot.value.content.slice(0, offset),
        suffix: snapshot.value.content.slice(offset),
        metadata: JSON.stringify({
          language: code ? 'python' : 'latex',
          literal: code,
          environments: code ? ['document', 'lstlisting'] : ['document'],
          indentation: code ? '    ' : '',
        }),
      };
      const start = performance.now();
      const result = await bridge.requestAICompletion(request);
      evidence.push({
        provider: id,
        model: model.id,
        transport: model.capabilities?.transport ?? 'chat',
        milliseconds: Math.round(performance.now() - start),
        outcome: result.ok ? 'passed live insertion response' : 'failed live request',
        ...(result.ok
          ? {
              insertionCharacters: result.value.text.length,
              insertionLines: result.value.text.split(/\r?\n/).length,
              identityMatches:
                result.value.requestId === request.requestId &&
                result.value.modelVersion === request.modelVersion &&
                result.value.offset === request.offset,
            }
          : { code: result.code, error: result.error }),
      });
    }
    return evidence;
  }, selectedProvider);
  // Report only model identifiers, timings and response sizes; no keys or source.
  console.log(JSON.stringify(report, null, 2));
} finally {
  await application?.close();
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
