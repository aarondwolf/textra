import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildService, detectTools } from '../../src/main/services/latex';
import type { BuildRequest, ToolInfo } from '../../src/shared/api';

describe('real local LaTeX builds (no package installation)', () => {
  let tools: ToolInfo[];
  let directory: string;
  let root: string;
  let service: BuildService;
  const projectId = 'real-tex-fixture';
  const request: BuildRequest = { projectId, rootFile: 'main.tex', engine: 'pdflatex' };

  beforeAll(async () => {
    tools = await detectTools();
  }, 60000);

  beforeEach(async () => {
    const parent = join(process.cwd(), '.test-data', 'latex-tests');
    await mkdir(parent, { recursive: true });
    directory = await mkdtemp(join(parent, 'case-'));
    root = join(directory, 'résumé project with spaces');
    await mkdir(root);
    service = new BuildService((id) => {
      if (id !== projectId) throw new Error('Stale project.');
      return root;
    }, 45000);
  });

  afterEach(async () => {
    await service.cancel();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  const hasTool = (name: string) => tools.some((tool) => tool.name === name && tool.path);
  const copyFixture = (name: string) =>
    cp(join(process.cwd(), 'tests', 'fixtures', name), root, { recursive: true });

  it('discovers capabilities without assuming a distribution is installed', () => {
    for (const name of [
      'pdflatex',
      'xelatex',
      'lualatex',
      'latexmk',
      'bibtex',
      'biber',
      'synctex',
    ]) {
      expect(tools.some((tool) => tool.name === name)).toBe(true);
    }
    for (const tool of tools) {
      if (!tool.path) expect(tool.version).toBeNull();
    }
  });

  it('compiles a real article and exposes only its successful PDF output', async (context) => {
    if (!hasTool('pdflatex'))
      context.skip('pdflatex is not installed; real compilation is unverified.');
    await copyFixture('minimal article');
    const result = await service.compile(request);
    expect(result.outcome, result.log).toBe('success');
    expect(result.running).toBe(false);
    expect(result.pdfPath).toBeTruthy();
    if (!result.pdfPath) throw new Error('Expected a successful output PDF path.');
    const pdf = await service.readPdf({ projectId, path: result.pdfPath });
    expect(Buffer.from(pdf).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
    await expect(service.readPdf({ projectId, path: 'main.tex' })).rejects.toThrow();
    await expect(service.readPdf({ projectId, path: '../outside.pdf' })).rejects.toThrow();
    expect(await readFile(join(root, 'main.tex'), 'utf8')).toContain('A local-first document');
    if (hasTool('synctex')) {
      const location = await service.syncForward({
        projectId,
        path: 'main.tex',
        rootFile: 'main.tex',
        line: 8,
      });
      expect(location.page).toBeGreaterThan(0);
      expect(Number.isFinite(location.x)).toBe(true);
      expect(Number.isFinite(location.y)).toBe(true);
      const inverse = await service.syncInverse({ projectId, rootFile: 'main.tex', ...location });
      expect(inverse.path).toBe('main.tex');
      expect(inverse.line).toBeGreaterThan(0);
    }
  }, 60000);

  it('builds included chapters, bibliography, table, and figure through the real BibTeX pipeline', async (context) => {
    if (!hasTool('pdflatex') || !hasTool('bibtex'))
      context.skip(
        'pdflatex or bibtex is not installed; real bibliography pipeline is unverified.',
      );
    await copyFixture('dissertation');
    const result = await service.compile({ ...request, engine: 'bibtex-pipeline' });
    expect(result.outcome, result.log).toBe('success');
    expect(result.pdfPath).toBeTruthy();
    if (!result.pdfPath) throw new Error('Expected a successful dissertation PDF.');
    const bibliography = await readFile(
      join(root, result.pdfPath.replace(/\.pdf$/, '.bbl')),
      'utf8',
    );
    expect(bibliography).toContain('knuth1984');
    if (hasTool('synctex')) {
      const location = await service.syncForward({
        projectId,
        rootFile: 'main.tex',
        path: 'chapters/introduction.tex',
        line: 3,
      });
      const inverse = await service.syncInverse({ projectId, rootFile: 'main.tex', ...location });
      expect(inverse.path).toBe('chapters/introduction.tex');
    }
  }, 60000);

  it('reports a real malformed build as failure and retains the previous successful PDF', async (context) => {
    if (!hasTool('pdflatex'))
      context.skip('pdflatex is not installed; real failure handling is unverified.');
    await copyFixture('minimal article');
    const successful = await service.compile(request);
    expect(successful.outcome, successful.log).toBe('success');
    await cp(
      join(process.cwd(), 'tests', 'fixtures', 'malformed', 'main.tex'),
      join(root, 'main.tex'),
    );
    const failed = await service.compile(request);
    expect(failed.outcome, failed.log).toBe('failed');
    expect(failed.log).toContain('Undefined control sequence');
    expect(failed.diagnostics.some((item) => item.severity === 'error')).toBe(true);
    if (!successful.pdfPath) throw new Error('Expected previous successful PDF.');
    expect(
      (await service.readPdf({ projectId, path: successful.pdfPath })).byteLength,
    ).toBeGreaterThan(1000);
  }, 60000);

  it('cancels an active real compiler process with a bounded safety timeout', async (context) => {
    if (!hasTool('pdflatex'))
      context.skip('pdflatex is not installed; real cancellation is unverified.');
    await writeFile(
      join(root, 'main.tex'),
      '\\documentclass{article}\n\\begin{document}\n\\loop\\iftrue\\repeat\n\\end{document}\n',
    );
    const compilation = service.compile(request);
    await vi.waitFor(() => expect(service.getState().log).toContain('> pdflatex'), {
      timeout: 10000,
    });
    await service.cancel();
    const result = await compilation;
    expect(result.outcome, result.log).toBe('cancelled');
    expect(result.running).toBe(false);
    expect(service.getState().running).toBe(false);
  }, 30000);

  it('terminates a non-finishing compiler at its configured timeout', async (context) => {
    if (!hasTool('pdflatex'))
      context.skip('pdflatex is not installed; real timeout is unverified.');
    await writeFile(
      join(root, 'main.tex'),
      '\\documentclass{article}\n\\begin{document}\n\\loop\\iftrue\\repeat\n\\end{document}\n',
    );
    const bounded = new BuildService(() => root, 3000);
    try {
      const result = await bounded.compile(request);
      expect(result.outcome).toBe('failed');
      expect(result.running).toBe(false);
      expect(result.log).toMatch(/timed? ?out|timeout/i);
      expect(result.log).toContain('> pdflatex');
    } finally {
      await bounded.cancel();
    }
  }, 30000);

  it('runs the installed latexmk without loading project rc files', async (context) => {
    if (!hasTool('pdflatex') || !hasTool('latexmk'))
      context.skip('latexmk or pdflatex is unavailable.');
    await copyFixture('minimal article');
    await writeFile(join(root, '.latexmkrc'), 'die "UNTRUSTED_RC_MUST_NOT_EXECUTE";\n');
    const result = await service.compile({ ...request, engine: 'latexmk' });
    expect(result.outcome, result.log).toBe('success');
    expect(result.log).toContain('-norc');
    expect(result.log).not.toContain('UNTRUSTED_RC_MUST_NOT_EXECUTE');
  }, 60000);
});
