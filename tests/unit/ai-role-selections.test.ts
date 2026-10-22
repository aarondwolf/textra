import { beforeEach, describe, expect, it } from 'vitest';
import type { AISettings } from '../../src/shared/api';
import {
  getAIRoleSelection,
  useAIRoleSelections,
} from '../../src/renderer/src/state/ai-role-selections';
import { modelGroups } from '../../src/renderer/src/features/chat/useAISettings';

const settings: AISettings = {
  configured: true,
  autoSendProblems: false,
  roleDefaults: {
    assistant: { provider: 'mistral', model: 'chat' },
    completion: null,
    inlineCompletion: { provider: 'mistral', model: 'chat' },
  },
  completion: { enabled: false, allowOutsideEnvironments: false, consentedModel: null },
  providers: [
    {
      id: 'mistral',
      configured: true,
      defaultModel: 'chat',
      modelsFetchedAt: null,
      error: null,
      models: [
        {
          id: 'chat',
          label: 'Chat',
          capabilities: { chat: true, completion: false, transport: 'chat' },
        },
        {
          id: 'fim',
          label: 'FIM',
          capabilities: { chat: false, completion: true, transport: 'mistral-fim' },
        },
      ],
    },
  ],
};

describe('temporary workspace role selections', () => {
  beforeEach(() => useAIRoleSelections.setState({ workspaces: {} }));
  it('uses independent saved defaults and isolates temporary workspace choices', () => {
    const select = useAIRoleSelections.getState().select;
    select('one', 'inlineCompletion', null);
    select('one', 'assistant', { provider: 'mistral', model: 'chat' });
    expect(getAIRoleSelection('one', 'inlineCompletion', settings)).toEqual({
      model: null,
      available: false,
    });
    expect(getAIRoleSelection('one', 'assistant', settings).available).toBe(true);
    expect(getAIRoleSelection('two', 'inlineCompletion', settings).available).toBe(true);
    expect(getAIRoleSelection('two', 'completion', settings).model).toBeNull();
    expect(settings.roleDefaults.inlineCompletion).not.toBeNull();
  });
  it('keeps an unavailable binding without substituting another model', () => {
    const missing = { provider: 'mistral' as const, model: 'removed' };
    useAIRoleSelections.getState().select('one', 'assistant', missing);
    expect(getAIRoleSelection('one', 'assistant', settings)).toEqual({
      model: missing,
      available: false,
    });
    expect(useAIRoleSelections.getState().workspaces.one.assistant).toEqual(missing);
    const restored = structuredClone(settings);
    restored.providers[0].models.push({ id: missing.model, label: 'Restored' });
    expect(getAIRoleSelection('one', 'assistant', restored)).toEqual({
      model: missing,
      available: true,
    });
    useAIRoleSelections.setState({ workspaces: {} });
    expect(getAIRoleSelection('one', 'assistant', settings).model).toEqual(
      settings.roleDefaults.assistant,
    );
  });
  it('filters role pickers and rejects incompatible temporary selections', () => {
    expect(
      modelGroups(settings, undefined, 'assistant')[0].models.map((model) => model.id),
    ).toEqual(['chat']);
    expect(
      modelGroups(settings, undefined, 'inlineCompletion')[0].models.map((model) => model.id),
    ).toEqual(['chat']);
    useAIRoleSelections
      .getState()
      .select('one', 'assistant', { provider: 'mistral', model: 'fim' });
    expect(getAIRoleSelection('one', 'assistant', settings).available).toBe(false);
  });
  it('retains silenced and hidden bindings while blocking their use', () => {
    const silenced = structuredClone(settings);
    silenced.providers[0].enabled = false;
    expect(getAIRoleSelection('one', 'assistant', silenced)).toEqual({
      model: settings.roleDefaults.assistant,
      available: false,
    });
    const hidden = structuredClone(settings);
    hidden.providers[0].filters = {
      chat: { mode: 'exclude', models: ['chat'] },
      completion: { mode: 'all', models: [] },
    };
    expect(getAIRoleSelection('one', 'assistant', hidden)).toEqual({
      model: settings.roleDefaults.assistant,
      available: false,
    });
    expect(modelGroups(hidden, undefined, 'assistant')).toEqual([]);
  });
});
