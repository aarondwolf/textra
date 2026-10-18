/** Only the exact application entry point may invoke privileged handlers. */
export function isTrustedRendererUrl(candidate: string, trustedUrl: string): boolean {
  try {
    const actual = new URL(candidate);
    const expected = new URL(trustedUrl);
    if (!['file:', 'http:'].includes(expected.protocol)) return false;
    if (
      expected.protocol === 'http:' &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(expected.hostname)
    ) {
      return false;
    }
    actual.hash = '';
    expected.hash = '';
    return actual.href === expected.href;
  } catch {
    return false;
  }
}
