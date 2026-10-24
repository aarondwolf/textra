import { describe, expect, it, vi } from 'vitest';
import { emitTextraEvent, onTextraEvent } from '../../src/renderer/src/services/events';

describe('typed event bus', () => {
  it('dispatches and listens to events with detail payload', () => {
    const handler = vi.fn();
    const unsubscribe = onTextraEvent('textra:notify', handler);

    emitTextraEvent('textra:notify', { message: 'Test notification', type: 'info' });

    expect(handler).toHaveBeenCalledWith({ message: 'Test notification', type: 'info' });
    unsubscribe();

    emitTextraEvent('textra:notify', { message: 'After unsubscribe', type: 'error' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('dispatches parameterless command events cleanly', () => {
    const handler = vi.fn();
    const unsubscribe = onTextraEvent('textra:compile', handler);

    emitTextraEvent('textra:compile');

    expect(handler).toHaveBeenCalledWith(undefined);
    unsubscribe();
  });
});
