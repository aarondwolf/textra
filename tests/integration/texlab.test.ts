import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TexlabService } from '../../src/main/services/texlab';

// Real bundled TexLab over stdio; no provider, process or protocol mocks.
describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
  'bundled TexLab protocol smoke',
  () => {
    it('serves a burst after repeated unchanged synchronization without invalidating work', async () => {
      const executable = join(process.cwd(), 'resources', 'texlab', 'win32-x64', 'texlab.exe');
      await access(executable);
      const root = await mkdtemp(join(tmpdir(), 'textra-texlab-'));
      const path = join(root, 'main.tex');
      const text =
        '\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\nHello world.\n\\end{document}\n';
      await writeFile(path, text);
      const service = new TexlabService({ requestTimeoutMs: 12000 });
      try {
        const initialized = await service.start({ executable, workspaceRoot: root });
        expect(initialized.capabilities).toBeTruthy();
        await service.openDocument({ path, text, version: 1 });
        const symbolsBeforeRepeatedSync = service.documentSymbols(path);
        for (let version = 2; version <= 16; version++)
          await service.openDocument({ path, text, version });
        // Unchanged synchronization must not invalidate the already-running query.
        expect(Array.isArray(await symbolsBeforeRepeatedSync)).toBe(true);
        const requests = Array.from({ length: 4 }, () => [
          service.completion(path, 2, 8),
          service.documentSymbols(path),
          service.foldingRanges(path),
          service.hover(path, 2, 3),
        ]).flat();
        const results = await Promise.all(requests);
        expect(results).toHaveLength(16);
        for (const result of results)
          expect(result === null || typeof result === 'object').toBe(true);
        expect(service.running).toBe(true);
        // The real server remains usable after a new version cancels old work.
        await service.changeDocument({
          path,
          text: text.replace('Hello world.', 'An edited sentence.'),
          version: 17,
        });
        expect(Array.isArray(await service.documentSymbols(path))).toBe(true);
      } finally {
        await service.stop();
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    }, 30000);
  },
);
