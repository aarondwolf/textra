import { describe, expect, it } from 'vitest';
import type { AISettings } from '../../src/shared/api';
import {
  findModel,
  modelGroups,
  modelUnavailableReason,
} from '../../src/renderer/src/features/chat/useAISettings';

function settings(): AISettings {
  return {
    configured: true,
    autoSendProblems: false,
    roleDefaults: { chat: null, agent: null, completion: null, inlineCompletion: null },
    completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
    providers: [
      {
        id: 'custom',
        configured: true,
        enabled: true,
        displayName: 'Lab server',
        defaultModel: null,
        modelsFetchedAt: null,
        error: null,
        filters: {
          chat: { mode: 'exclude', models: ['hidden'] },
          completion: { mode: 'include', models: ['fim'] },
        },
        models: [
          {
            id: 'chat',
            label: 'Chat',
            capabilities: { chat: true, completion: true, transport: 'chat' },
          },
          {
            id: 'hidden',
            label: 'Hidden chat',
            capabilities: { chat: true, completion: true, transport: 'chat' },
          },
          {
            id: 'fim',
            label: 'FIM only',
            capabilities: { chat: false, completion: true, transport: 'mistral-fim' },
          },
        ],
      },
    ],
  };
}

describe('role model visibility', () => {
  it('applies independent exact-ID groups and excludes FIM-only models from inline edits', () => {
    const value = settings();
    expect(modelGroups(value, undefined, 'chat')[0]).toMatchObject({
      label: 'Lab server',
      models: [{ id: 'chat' }],
    });
    expect(
      modelGroups(value, undefined, 'inlineCompletion')[0].models.map((model) => model.id),
    ).toEqual(['chat']);
    expect(modelGroups(value, undefined, 'completion')[0].models.map((model) => model.id)).toEqual([
      'fim',
    ]);
    expect(findModel(value, { provider: 'custom', model: 'hidden' }, 'agent')).toBeNull();
    expect(
      modelUnavailableReason(value, { provider: 'custom', model: 'hidden' }, 'agent'),
    ).toContain('hidden');
    expect(findModel(value, { provider: 'custom', model: 'fim' }, 'inlineCompletion')).toBeNull();
    expect(
      modelUnavailableReason(value, { provider: 'custom', model: 'fim' }, 'inlineCompletion'),
    ).toContain('does not support');
  });
  it('silences without deleting catalog data and removes unsupported Agent connections', () => {
    const value = settings();
    value.providers[0].enabled = false;
    expect(modelGroups(value)).toEqual([]);
    expect(findModel(value, { provider: 'custom', model: 'chat' }, 'chat')).toBeNull();
    expect(modelUnavailableReason(value, { provider: 'custom', model: 'chat' }, 'chat')).toContain(
      'silenced',
    );
    expect(value.providers[0].models).toHaveLength(3);
    value.providers[0].enabled = true;
    value.providers[0].supportsTools = false;
    expect(modelGroups(value, undefined, 'agent')).toEqual([]);
    expect(modelUnavailableReason(value, { provider: 'custom', model: 'chat' }, 'agent')).toContain(
      'Tool calls are disabled',
    );
    expect(
      modelUnavailableReason(value, { provider: 'custom', model: 'removed' }, 'chat'),
    ).toContain('missing');
    expect(modelUnavailableReason(value, { provider: 'openai', model: 'chat' }, 'chat')).toContain(
      'removed',
    );
    expect(modelGroups(value, undefined, 'inlineCompletion')[0].models).toHaveLength(1);
  });
  it('supports include/exclude resets and hides legacy dedicated profiles', () => {
    const value = settings();
    value.providers[0].filters = {
      chat: { mode: 'all', models: ['hidden'] },
      completion: { mode: 'all', models: [] },
    };
    expect(modelGroups(value, undefined, 'chat')[0].models.map((model) => model.id)).toEqual([
      'chat',
      'hidden',
    ]);
    value.providers[0].id = 'codestral';
    expect(modelGroups(value)).toEqual([]);
    expect(findModel(value, { provider: 'codestral', model: 'chat' })).toBeNull();
  });
});
