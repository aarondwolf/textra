import { describe, expect, it } from 'vitest';
import { isTrustedRendererUrl } from '../../src/main/security';

describe('privileged renderer entry point matching', () => {
  const trusted = 'file:///C:/TeXtra/out/renderer/index.html';

  it('allows the application entry point and local anchor navigation', () => {
    expect(isTrustedRendererUrl(trusted, trusted)).toBe(true);
    expect(isTrustedRendererUrl(`${trusted}#editor`, trusted)).toBe(true);
  });

  it.each([
    'file:///C:/TeXtra/out/renderer/other.html',
    `${trusted}?project=untrusted`,
    `${trusted}/child`,
    'https://example.com/',
    'data:text/html,hello',
    'javascript:alert(1)',
    'not a URL',
  ])('rejects a different or malformed sender: %s', (candidate) => {
    expect(isTrustedRendererUrl(candidate, trusted)).toBe(false);
  });

  it.each(['127.0.0.1', 'localhost', '[::1]'])('allows the exact local dev URL on %s', (host) => {
    const development = `http://${host}:5173/`;
    expect(isTrustedRendererUrl(development, development)).toBe(true);
    expect(isTrustedRendererUrl(`http://${host}:5174/`, development)).toBe(false);
    expect(isTrustedRendererUrl(`${development}other`, development)).toBe(false);
  });

  it.each(['http://example.com/', 'https://localhost:5173/', 'data:text/html,hello'])(
    'rejects an unsafe configured entry point: %s',
    (candidate) => {
      expect(isTrustedRendererUrl(candidate, candidate)).toBe(false);
    },
  );
});
