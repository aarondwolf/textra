import { setTimeout as delay } from 'node:timers/promises';

/**
 * Retries transient filesystem locks (EPERM, EBUSY, EACCES) which commonly occur
 * on Windows when files are indexed, scanned by antivirus, or locked briefly by sync services.
 */
export async function retryTransient<T>(
  action: () => Promise<T>,
  delays: number[] = [50, 100, 200, 400, 800],
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (
        attempt >= delays.length ||
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        !['EPERM', 'EBUSY', 'EACCES'].includes(String(error.code))
      )
        throw error;
      await delay(delays[attempt]);
    }
  }
}
