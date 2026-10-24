import { describe, expect, it } from 'vitest';
import { retryTransient } from '../../src/main/services/retry';

describe('retryTransient', () => {
  it('returns immediately when the operation succeeds on the first try', async () => {
    let calls = 0;
    const result = await retryTransient(async () => {
      calls++;
      return 'success';
    });
    expect(result).toBe('success');
    expect(calls).toBe(1);
  });

  it('retries on transient Windows error codes (EPERM, EBUSY, EACCES) and returns success', async () => {
    let calls = 0;
    const transientCodes = ['EBUSY', 'EPERM', 'EACCES'];
    const result = await retryTransient(async () => {
      calls++;
      if (calls <= 3) {
        const err = new Error('Transient lock');
        Object.assign(err, { code: transientCodes[calls - 1] });
        throw err;
      }
      return 'recovered';
    }, [5, 5, 5, 5]);
    expect(result).toBe('recovered');
    expect(calls).toBe(4);
  });

  it('throws non-transient errors immediately without retrying', async () => {
    let calls = 0;
    await expect(
      retryTransient(async () => {
        calls++;
        const err = new Error('File not found');
        Object.assign(err, { code: 'ENOENT' });
        throw err;
      }, [5, 5]),
    ).rejects.toThrow('File not found');
    expect(calls).toBe(1);
  });

  it('throws after all retry delays are exhausted', async () => {
    let calls = 0;
    await expect(
      retryTransient(async () => {
        calls++;
        const err = new Error('Persistent lock');
        Object.assign(err, { code: 'EBUSY' });
        throw err;
      }, [5, 5]),
    ).rejects.toThrow('Persistent lock');
    expect(calls).toBe(3); // 1 initial + 2 retries
  });
});
