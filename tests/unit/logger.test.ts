import { describe, expect, it } from 'vitest';
import { formatLog, redact } from '../../src/main/services/logger';

describe('structured log redaction', () => {
  it('redacts credential keys throughout nested objects and arrays without mutating input', () => {
    const input = {
      count: 3,
      Authorization: 'secret-a',
      providers: [{ apiKey: 'secret-b', name: 'local' }],
      nested: { password: 'secret-c', access_token: 'secret-d' },
    };
    expect(redact(input)).toEqual({
      count: 3,
      Authorization: '[REDACTED]',
      providers: [{ apiKey: '[REDACTED]', name: 'local' }],
      nested: { password: '[REDACTED]', access_token: '[REDACTED]' },
    });
    expect(input.providers[0].apiKey).toBe('secret-b');
  });

  it.each([
    ['Bearer sensitive-value', 'sensitive-value'],
    ['Failed with sk-exampleSecretValue', 'sk-exampleSecretValue'],
    ['Failed with ghp_exampleSecretValue', 'ghp_exampleSecretValue'],
    ['Failed with github_pat_exampleSecretValue', 'github_pat_exampleSecretValue'],
    ['token=sensitive-value', 'sensitive-value'],
    ['password: sensitive-value', 'sensitive-value'],
  ])('removes secret-like values from message %s', (message, sensitive) => {
    expect(redact(message)).not.toContain(sensitive);
    expect(redact(message)).toContain('[REDACTED]');
  });

  it('serializes useful error diagnostics without exposing credentials or stack traces', () => {
    const line = formatLog('error', 'request-failed', new Error('token=sensitive-value'));
    expect(line).not.toContain('sensitive-value');
    expect(line).not.toContain('stack');
    const entry: unknown = JSON.parse(line);
    expect(entry).toMatchObject({
      level: 'error',
      event: 'request-failed',
      details: { name: 'Error', message: 'token=[REDACTED]' },
    });
  });

  it('handles circular diagnostic objects without breaking error reporting', () => {
    const details: { stage: string; self?: unknown } = { stage: 'startup' };
    details.self = details;
    expect(() => formatLog('warn', 'cycle', details)).not.toThrow();
    expect(formatLog('warn', 'cycle', details)).toContain('[CIRCULAR]');
  });
});
