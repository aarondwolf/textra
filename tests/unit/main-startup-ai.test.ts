import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AIService } from '../../src/main/services/ai-service';
import * as runtime from '../../src/main/services/ai-sdk-runtime';

let directory: string;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('prepares enabled default adapters in role order without decrypting, networking or launching Ollama', async () => {
  directory = await mkdtemp(join(tmpdir(), 'textra-prepare-ai-'));
  const provider = (model: string, enabled = true) => ({
    enabled,
    encryptedKey: 'eA==',
    defaultModel: model,
    models: [{ id: model, label: model }],
    modelsFetchedAt: null,
    error: null,
  });
  const settings = {
    version: 5,
    autoSendProblems: false,
    providers: {
      google: provider('gemini-2.5-flash'),
      openai: provider('gpt-5-mini'),
      'ollama-local': provider('qwen2.5-coder:0.5b'),
    },
    roleDefaults: {
      assistant: { provider: 'google', model: 'gemini-2.5-flash' },
      inlineCompletion: { provider: 'openai', model: 'gpt-5-mini' },
      completion: { provider: 'ollama-local', model: 'qwen2.5-coder:0.5b' },
    },
    completion: { enabled: false, consentedModel: null, allowOutsideEnvironments: false },
  };
  await writeFile(join(directory, 'ai.json'), JSON.stringify(settings));
  const decrypt = vi.fn(() => {
    throw Error('must stay encrypted');
  });
  const network = vi.fn(() => {
    throw Error('must stay offline');
  });
  vi.stubGlobal('fetch', network);
  const start = vi.fn(async () => undefined);
  const service = new AIService(
    directory,
    { available: () => true, encrypt: () => Buffer.alloc(0), decrypt },
    { ollama: { find: vi.fn(async () => null), start, version: vi.fn(async () => null) } },
  );
  const prepare = vi.spyOn(runtime, 'prepareSDKProvider').mockResolvedValue(undefined);
  await service.prepare();
  expect(prepare.mock.calls.map(([id]) => id)).toEqual(['google', 'openai']);
  expect(decrypt).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();

  prepare.mockClear();
  settings.providers.google.enabled = false;
  settings.roleDefaults.inlineCompletion = settings.roleDefaults.assistant;
  await writeFile(join(directory, 'ai.json'), JSON.stringify(settings));
  await service.prepare();
  expect(prepare).not.toHaveBeenCalled();

  settings.providers.google.enabled = true;
  await writeFile(join(directory, 'ai.json'), JSON.stringify(settings));
  await service.prepare();
  expect(prepare.mock.calls.map(([id]) => id)).toEqual(['google']);
});
