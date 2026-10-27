import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { lazyFeature } from '../../src/renderer/src/features/startup/LazyFeature';

describe('feature code preparation', () => {
  it('coalesces preparation and renders subsequent mounts without a loading fallback', async () => {
    const load = vi.fn(async () => ({
      default: ({ text }: { text: string }) => createElement('p', null, text),
    }));
    const Feature = lazyFeature(load, 'Example');
    await Promise.all([Feature.preload(), Feature.preload()]);
    for (const text of ['First visit', 'Return visit']) {
      const markup = renderToString(createElement(Feature, { text }));
      expect(markup).toContain(`<p>${text}</p>`);
      expect(markup).not.toContain('Loading example');
    }
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('allows an unsuccessful background import to be retried', async () => {
    const load = vi.fn(async () => ({ default: () => createElement('p', null, 'Ready') }));
    load.mockRejectedValueOnce(new Error('Import unavailable'));
    const Feature = lazyFeature(load, 'Example');
    await expect(Feature.preload()).rejects.toThrow('Import unavailable');
    await Feature.preload();
    expect(renderToString(createElement(Feature))).toContain('<p>Ready</p>');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
