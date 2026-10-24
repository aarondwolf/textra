import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeAtomic } from '../../src/main/services/atomic-write';

describe('writeAtomic', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'atomic-write-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('atomically writes a string file and flushes it', async () => {
    const target = join(tempDir, 'test.txt');
    await writeAtomic(target, 'hello world', { prefix: 'test' });
    const content = await readFile(target, 'utf8');
    expect(content).toBe('hello world');
  });

  it('atomically writes binary buffer data', async () => {
    const target = join(tempDir, 'binary.dat');
    const buffer = Buffer.from([1, 2, 3, 4, 5]);
    await writeAtomic(target, buffer);
    const readBack = await readFile(target);
    expect(readBack).toEqual(buffer);
  });

  it('creates parent directory when ensureDir is true', async () => {
    const target = join(tempDir, 'nested', 'sub', 'test.txt');
    await writeAtomic(target, 'nested content', { ensureDir: true });
    const content = await readFile(target, 'utf8');
    expect(content).toBe('nested content');
  });

  it('cleans up temporary file if prePublish throws', async () => {
    const target = join(tempDir, 'failed.txt');
    await expect(
      writeAtomic(target, 'will fail', {
        prePublish: () => {
          throw new Error('validation failed');
        },
      }),
    ).rejects.toThrow('validation failed');

    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('supports custom publish function', async () => {
    const target = join(tempDir, 'custom.txt');
    let published = false;
    await writeAtomic(target, 'custom publish', {
      publish: async (temp, dest) => {
        const { rename } = await import('node:fs/promises');
        await rename(temp, dest);
        published = true;
      },
    });
    expect(published).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('custom publish');
  });
});
