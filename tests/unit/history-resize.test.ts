import { afterEach, expect, it, vi } from 'vitest';
import { beginHistoryResize } from '../../src/renderer/src/features/history/history-resize';

afterEach(() => vi.unstubAllGlobals());

it('releases drag listeners and restores document styles when the owner unmounts mid-drag', () => {
  const target = new EventTarget();
  const remove = vi.spyOn(target, 'removeEventListener');
  vi.stubGlobal('window', target);
  const style = { cursor: 'default', userSelect: 'text' };
  vi.stubGlobal('document', { body: { style } });
  const update = vi.fn();
  const dispose = beginHistoryResize(200, 160, update);
  target.dispatchEvent(Object.assign(new Event('mousemove'), { clientY: 180 }));
  expect(update).toHaveBeenLastCalledWith(180);
  dispose();
  dispose();
  target.dispatchEvent(Object.assign(new Event('mousemove'), { clientY: 170 }));
  expect(update).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledTimes(2);
  expect(style).toEqual({ cursor: 'default', userSelect: 'text' });
});
