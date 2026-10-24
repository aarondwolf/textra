import { appendFile, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBounded } from '../../src/main/services/bounded-read';

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0))
    await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function fixture(content: Buffer): Promise<string> {
  const base = join(process.cwd(), '.test-data', 'bounded-read');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'case-'));
  directories.push(directory);
  const path = join(directory, 'document.tex');
  await writeFile(path, content);
  return path;
}

describe('bounded EOF reads', () => {
  it('reads growth after stat through actual EOF instead of returning a prefix', async () => {
    const path = await fixture(Buffer.alloc(1000, 65));
    const file = await open(path, 'r');
    try {
      expect((await file.stat()).size).toBe(1000);
      await appendFile(path, Buffer.alloc(11000, 66));
      const bytes = await readBounded(file, 20000, () => {
        throw new Error('too large');
      });
      expect(bytes).toEqual(Buffer.concat([Buffer.alloc(1000, 65), Buffer.alloc(11000, 66)]));
    } finally {
      await file.close();
    }
  });
  it.each([0, 65536, 131072])('accepts exact limits including empty files: %i', async (maximum) => {
    const path = await fixture(Buffer.alloc(maximum, 65));
    const file = await open(path, 'r');
    try {
      expect(
        await readBounded(file, maximum, () => {
          throw new Error('too large');
        }),
      ).toHaveLength(maximum);
    } finally {
      await file.close();
    }
  });
  it('rejects growth beyond the maximum rather than silently truncating it', async () => {
    const path = await fixture(Buffer.alloc(1000, 65));
    const file = await open(path, 'r');
    try {
      await file.stat();
      await appendFile(path, Buffer.alloc(11000, 66));
      await expect(
        readBounded(file, 4096, () => {
          throw new Error('too large');
        }),
      ).rejects.toThrow('too large');
    } finally {
      await file.close();
    }
  });
});
