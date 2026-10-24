import type { FileHandle } from 'node:fs/promises';

/** Read until actual EOF, including files which grow after stat, with a strict byte cap. */
export async function readBounded(
  file: Pick<FileHandle, 'read'>,
  maximum: number,
  tooLarge: () => never,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1 - size));
    const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) return Buffer.concat(chunks, size);
    size += bytesRead;
    if (size > maximum) tooLarge();
    chunks.push(chunk.subarray(0, bytesRead));
  }
}
