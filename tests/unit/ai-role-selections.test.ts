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
    chat: { provider: 'mistral', model: 'chat' },
    agent: null,
    completion: null,
    inlineCompletion: null,
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
    select('one', 'agent', { provider: 'mistral', model: 'chat' });
    select('one', 'chat', null);
    expect(getAIRoleSelection('one', 'chat', settings)).toEqual({ model: null, available: false });
    expect(getAIRoleSelection('one', 'agent', settings).available).toBe(true);
    expect(getAIRoleSelection('two', 'chat', settings).available).toBe(true);
    expect(getAIRoleSelection('two', 'agent', settings).model).toBeNull();
    expect(settings.roleDefaults.agent).toBeNull();
  });
  it('clears a missing selected model without substituting the saved default or reviving it', () => {
    const missing = { provider: 'mistral' as const, model: 'removed' };
    useAIRoleSelections.getState().select('one', 'chat', missing);
    expect(getAIRoleSelection('one', 'chat', settings)).toEqual({
      model: null,
      available: false,
    });
    expect(useAIRoleSelections.getState().workspaces.one.chat).toBeNull();
    const restored = structuredClone(settings);
    restored.providers[0].models.push({ id: missing.model, label: 'Restored' });
    expect(getAIRoleSelection('one', 'chat', restored).model).toBeNull();
    useAIRoleSelections.setState({ workspaces: {} });
    expect(getAIRoleSelection('one', 'chat', settings).model).toEqual(settings.roleDefaults.chat);
  });
  it('filters role pickers and rejects incompatible temporary selections', () => {
    expect(modelGroups(settings, undefined, 'chat')[0].models.map((model) => model.id)).toEqual([
      'chat',
    ]);
    expect(
      modelGroups(settings, undefined, 'inlineCompletion')[0].models.map((model) => model.id),
    ).toEqual(['fim']);
    useAIRoleSelections.getState().select('one', 'agent', { provider: 'mistral', model: 'fim' });
    expect(getAIRoleSelection('one', 'agent', settings).available).toBe(false);
  });
});
