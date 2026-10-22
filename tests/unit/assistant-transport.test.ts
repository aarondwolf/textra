import { describe, expect, it } from 'vitest';
import {
  fromUIMessages,
  toUIMessages,
} from '../../src/renderer/src/features/chat/assistant-transport';
import {
  appendUserTurn,
  coalesceProviderMessages,
} from '../../src/renderer/src/features/chat/conversation';

describe('assistant conversation turns', () => {
  it('keeps a new prompt separate from an unanswered previous user turn', () => {
    const original = [{ role: 'user' as const, text: 'First prompt' }];
    const next = appendUserTurn(original, 'Second prompt');
    expect(next).toEqual([
      { role: 'user', text: 'First prompt' },
      { role: 'user', text: 'Second prompt' },
    ]);
    expect(original).toEqual([{ role: 'user', text: 'First prompt' }]);
  });

  it('keeps visible bubbles separate and coalesces them only for provider requests', () => {
    const ui = toUIMessages([
      { role: 'user', text: 'First prompt' },
      { role: 'user', text: 'Second prompt' },
    ]);
    expect(fromUIMessages(ui)).toEqual([
      { role: 'user', text: 'First prompt' },
      { role: 'user', text: 'Second prompt' },
    ]);
    expect(fromUIMessages(ui, true)).toEqual([
      { role: 'user', text: 'First prompt\n\nSecond prompt' },
    ]);
    expect(coalesceProviderMessages(fromUIMessages(ui))).toEqual([
      { role: 'user', text: 'First prompt\n\nSecond prompt' },
    ]);
  });
});
