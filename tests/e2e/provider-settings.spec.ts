import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import type { AISettings } from '../../src/shared/api';
import type { AIModelInfo, AIProviderConfiguration } from '../../src/shared/ai';

interface ProviderTestState {
  settings: AISettings;
  configurations: AIProviderConfiguration[];
  refreshes: number;
  statusChecks: number;
}

test('custom provider saves locally, filters exact models, resets defaults and silences independently', async () => {
  test.setTimeout(90000);
  const root = join(process.cwd(), 'test-results', 'provider-settings');
  await mkdir(root, { recursive: true });
  const userData = await mkdtemp(join(root, 'profile-'));
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
    // Native dialogs and renderer are real. Only provider settings/configure/list
    // boundaries are mocked: this test never writes a key or contacts a server.
    await application.evaluate(({ ipcMain }) => {
      const model = (id: string): AIModelInfo => ({
        id,
        label: id,
        capabilities: {
          chat: id !== 'code-a',
          completion: true,
          transport: id === 'code-a' ? 'mistral-fim' : 'chat',
        },
      });
      const state: ProviderTestState = {
        settings: {
          configured: false,
          autoSendProblems: false,
          roleDefaults: { assistant: null, completion: null, inlineCompletion: null },
          completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
          providers: [
            {
              id: 'custom',
              configured: false,
              defaultModel: null,
              models: [],
              modelsFetchedAt: null,
              error: null,
            },
          ],
        },
        configurations: [],
        refreshes: 0,
        statusChecks: 0,
      };
      (globalThis as typeof globalThis & { providerTest: ProviderTestState }).providerTest = state;
      for (const channel of [
        'textra:ai:settings',
        'textra:ai:provider:configure',
        'textra:ai:models:refresh',
        'textra:ai:ollama:status',
      ])
        ipcMain.removeHandler(channel);
      ipcMain.handle('textra:ai:settings', () => ({ ok: true, value: state.settings }));
      ipcMain.handle('textra:ai:provider:configure', (_event, request: AIProviderConfiguration) => {
        state.configurations.push(request);
        state.settings.providers = [
          {
            id: 'custom',
            configured: true,
            enabled: request.enabled,
            endpoint: request.endpoint,
            displayName: request.displayName,
            defaultModel: request.defaultModel,
            filters: request.filters,
            supportsTools: request.supportsTools,
            manualModels: request.manualModels,
            models: request.manualModels.map(model),
            modelsFetchedAt: null,
            error: null,
          },
        ];
        return { ok: true, value: state.settings };
      });
      ipcMain.handle('textra:ai:models:refresh', () => {
        state.refreshes++;
        state.settings.providers[0].models = ['chat-a', 'chat-b', 'code-a'].map(model);
        state.settings.providers[0].modelsFetchedAt = Date.now();
        return { ok: true, value: state.settings };
      });
      ipcMain.handle('textra:ai:ollama:status', () => {
        state.statusChecks++;
        return { ok: true, value: { running: false, version: null, installed: false } };
      });
    });
    const snapshot = () =>
      application!.evaluate(
        () => (globalThis as typeof globalThis & { providerTest: ProviderTestState }).providerTest,
      );
    await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await settings.getByRole('button', { name: 'AI Settings', exact: true }).click();
    const ai = settings.locator('.ai-settings-inline');
    await expect(ai).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('textra-ai-settings-changed')));
    await expect(ai.locator('.ai-provider-connection')).toHaveCount(0);
    await ai.getByRole('button', { name: 'Add provider', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: 'Add provider', exact: true });
    await expect(chooser.getByRole('button', { name: 'Codestral', exact: true })).toHaveCount(0);
    await chooser.getByRole('button', { name: 'OpenAI-compatible', exact: true }).click();
    const editor = page.getByRole('dialog', { name: /^(Add|Edit) OpenAI-compatible$/ });
    const key = editor.getByLabel('API key (optional)', { exact: true });
    await expect(key).toHaveAttribute('type', 'password');
    await expect(key).toHaveValue('');
    await expect(
      editor.getByRole('checkbox', {
        name: 'Supports tool calls (lets the assistant read and propose document edits)',
        exact: true,
      }),
    ).not.toBeChecked();
    await editor.getByLabel('Connection name', { exact: true }).fill('Lab server');
    const endpoint = editor.getByLabel('Endpoint', { exact: true });
    await endpoint.fill('http://127.0.0.1:9999/v1');
    await expect(editor).toContainText('HTTP sends requests without transport encryption.');
    await editor.getByLabel('Manual model IDs', { exact: true }).fill('chat-a\nchat-b\ncode-a');
    const defaultModel = editor.getByRole('button', {
      name: 'Connection default model',
      exact: true,
    });
    await defaultModel.click();
    await page
      .getByRole('menu', { name: 'Connection default model', exact: true })
      .getByRole('menuitemradio', { name: 'chat-a', exact: true })
      .click();
    const chatFilter = editor.getByRole('group', {
      name: 'Assistant and inline completion',
      exact: true,
    });
    const autoFilter = editor.getByRole('group', { name: 'Automatic completion', exact: true });
    const chatVisibility = chatFilter.getByRole('button', {
      name: 'Assistant and inline completion visibility',
      exact: true,
    });
    await chatVisibility.click();
    await page
      .getByRole('menu', { name: 'Assistant and inline completion visibility', exact: true })
      .getByRole('menuitemradio', { name: 'Include selected models', exact: true })
      .click();
    await chatFilter
      .getByRole('textbox', {
        name: 'Search assistant and inline completion models',
        exact: true,
      })
      .fill('chat-a');
    await expect(chatFilter.getByRole('checkbox')).toHaveCount(1);
    await chatFilter.getByRole('checkbox').check();
    const automaticVisibility = autoFilter.getByRole('button', {
      name: 'Automatic completion visibility',
      exact: true,
    });
    await automaticVisibility.click();
    await page
      .getByRole('menu', { name: 'Automatic completion visibility', exact: true })
      .getByRole('menuitemradio', { name: 'Exclude selected models', exact: true })
      .click();
    await autoFilter
      .getByRole('textbox', { name: 'Automatic completion exact model IDs', exact: true })
      .fill('code-a');
    await editor.getByRole('button', { name: 'Save Lab server', exact: true }).click();
    const row = ai.getByRole('region', { name: 'Lab server', exact: true });
    await expect(row).toContainText('1 assistant · 2 automatic');
    await expect(row).toContainText('http://127.0.0.1:9999/v1');
    let state = await snapshot();
    expect(state.refreshes).toBe(0);
    expect(state.statusChecks).toBe(0);
    expect(state.configurations[0]).toMatchObject({
      provider: 'custom',
      enabled: true,
      endpoint: 'http://127.0.0.1:9999/v1',
      displayName: 'Lab server',
      defaultModel: 'chat-a',
      supportsTools: false,
      filters: {
        chat: { mode: 'include', models: ['chat-a'] },
        completion: { mode: 'exclude', models: ['code-a'] },
      },
      manualModels: ['chat-a', 'chat-b', 'code-a'],
    });
    expect(state.configurations[0].apiKey).toBeUndefined();

    await row.getByRole('button', { name: 'Edit Lab server', exact: true }).click();
    await expect(defaultModel).toHaveText('chat-a');
    await expect(chatVisibility).toHaveText('Include selected models');
    await expect(automaticVisibility).toHaveText('Exclude selected models');
    await editor.getByRole('button', { name: 'Test / Refresh models', exact: true }).click();
    await expect(editor.getByRole('status')).toHaveText('Connection tested. Models refreshed.');
    expect((await snapshot()).refreshes).toBe(1);
    await expect(defaultModel).toHaveText('chat-a');
    await editor.getByRole('button', { name: 'Reset default model', exact: true }).click();
    await expect(defaultModel).toHaveText('Not set');
    await editor.getByRole('button', { name: 'Reset endpoint', exact: true }).click();
    await expect(endpoint).toHaveValue('');
    await endpoint.fill('https://models.example.test/v1');
    await expect(editor).not.toContainText('HTTP sends requests without transport encryption.');
    await page.screenshot({ path: test.info().outputPath('custom-provider-filters.png') });
    await editor.getByRole('button', { name: 'Save Lab server', exact: true }).click();
    state = await snapshot();
    expect(state.configurations.at(-1)?.defaultModel).toBeNull();
    const enabled = row.getByRole('switch', { name: 'Lab server enabled', exact: true });
    // The switch is controlled by the saved settings, so its state changes after the save.
    await enabled.click();
    await expect(enabled).not.toBeChecked();
    await expect(row).toContainText('Disabled');
    state = await snapshot();
    expect(state.configurations.at(-1)).toMatchObject({
      enabled: false,
      defaultModel: null,
      manualModels: ['chat-a', 'chat-b', 'code-a'],
    });
    expect(state.settings.providers[0].models).toHaveLength(3);
    expect(state.refreshes).toBe(1);
    await enabled.click();
    await expect(enabled).toBeChecked();
    await expect(row).toContainText('1 assistant · 2 automatic');
    await row.getByRole('button', { name: 'Edit Lab server', exact: true }).click();
    await chatFilter
      .getByRole('button', {
        name: 'Reset Assistant and inline completion visibility',
        exact: true,
      })
      .click();
    await autoFilter
      .getByRole('button', { name: 'Reset Automatic completion visibility', exact: true })
      .click();
    await editor.getByRole('button', { name: 'Save Lab server', exact: true }).click();
    await expect(row).toContainText('2 assistant · 3 automatic');
    state = await snapshot();
    expect(state.configurations.at(-1)?.filters).toEqual({
      chat: { mode: 'all', models: [] },
      completion: { mode: 'all', models: [] },
    });
    expect(state.refreshes).toBe(1);
    expect(state.statusChecks).toBe(0);
    await page.screenshot({ path: test.info().outputPath('custom-provider-row.png') });
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
  } finally {
    if (application) {
      await application
        .evaluate(({ app }) => {
          setImmediate(() => app.exit(0));
        })
        .catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
