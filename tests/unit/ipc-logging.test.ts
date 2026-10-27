import { describe, expect, it } from 'vitest';
import { shouldLogIpcFailure } from '../../src/main/services/ipc-logging';

describe('IPC failure logging', () => {
  it('treats only missing reference probes as expected, while preserving other warnings', () => {
    expect(shouldLogIpcFailure('textra:file:read-reference-candidate', 'NOT_FOUND')).toBe(false);
    expect(shouldLogIpcFailure('textra:file:read', 'NOT_FOUND')).toBe(true);
    expect(shouldLogIpcFailure('textra:file:read-reference-candidate', 'ACCESS_DENIED')).toBe(true);
    expect(shouldLogIpcFailure('textra:file:read-reference-candidate', 'INVALID_PATH')).toBe(true);
  });

  it('retains existing expected cancellation handling', () => {
    expect(shouldLogIpcFailure('textra:ai:completion:request', 'AI_CANCELLED')).toBe(false);
    expect(shouldLogIpcFailure('textra:file:read', 'APP_CLOSING')).toBe(false);
    expect(shouldLogIpcFailure('textra:file:read', 'AI_CANCELLED')).toBe(true);
  });
});
