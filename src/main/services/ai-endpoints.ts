import { isIP } from 'node:net';

/** Offline endpoint validation; plain HTTP is restricted to local/private IPs. */
export function validateAIEndpoint(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    /[?#]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  )
    throw new Error('Enter a valid provider base URL.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid provider base URL.');
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['https:', 'http:'].includes(url.protocol)
  )
    throw new Error(
      'Use HTTPS, or HTTP for a private/loopback server, without credentials, query or fragment.',
    );
  if (!url.hostname || (url.protocol === 'http:' && !privateHost(url.hostname)))
    throw new Error('Plain HTTP is only allowed for private or loopback server addresses.');
  return url.href.replace(/\/+$/, '');
}
function privateHost(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (isIP(name) === 4) {
    const [a, b] = name.split('.').map(Number);
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIP(name) === 6) {
    if (name === '::1' || /^(?:fc|fd)[0-9a-f]{2}:/.test(name) || /^fe[89ab][0-9a-f]:/.test(name))
      return true;
    // URL canonicalization represents IPv4-mapped IPv6 as two hexadecimal groups.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(name);
    if (mapped) {
      const high = parseInt(mapped[1], 16),
        low = parseInt(mapped[2], 16);
      return privateHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  return false;
}
