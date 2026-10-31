import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

test('missing reference probes are quiet while ordinary missing reads are logged', async () => {
  const root = join(process.cwd(), '.test-data', 'reference-probe');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'case-'));
  const project = join(directory, 'project');
  const userData = join(directory, 'user-data');
  await mkdir(project);
  await mkdir(userData);
  await writeFile(join(project, 'main.tex'), '\\input{missing}\n');
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = userData;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NO_SANDBOX;
  const application = await electron.launch({ args: ['.'], env });
  let warnings = '';
  application.process().stderr?.on('data', (data: Buffer) => (warnings += data.toString()));
  try {
    const page = await application.firstWindow();
    await application.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, project);
    const results = await page.evaluate(async () => {
      const selected = await window.textra.chooseProject();
      if (!selected.ok || !selected.value) throw new Error('Project was not opened');
      const ref = { projectId: selected.value.id, path: 'absent.tex' };
      return {
        candidate: await window.textra.readReferenceCandidate(ref),
        ordinary: await window.textra.readFile(ref),
        pdfCandidate: await window.textra.readProjectPdfCandidate({ ...ref, path: 'absent.pdf' }),
        pdfOrdinary: await window.textra.readProjectPdf({ ...ref, path: 'absent.pdf' }),
        invalidPdf: await window.textra.readProjectPdfCandidate({ ...ref, path: '../outside.pdf' }),
      };
    });
    expect(results.candidate).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(results.ordinary).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(results.pdfCandidate).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(results.pdfOrdinary).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(results.invalidPdf.ok).toBe(false);
    await expect.poll(() => warnings).toContain('"channel":"textra:file:read"');
    expect(warnings).not.toContain('"channel":"textra:file:read-reference-candidate"');
    await expect.poll(() => warnings).toContain('"channel":"textra:pdf:read-project"');
    await expect
      .poll(() => warnings)
      .toContain('"channel":"textra:pdf:read-project-candidate","code":"INVALID_PATH"');
    expect(warnings).not.toContain(
      '"channel":"textra:pdf:read-project-candidate","code":"NOT_FOUND"',
    );
  } finally {
    await application
      .evaluate(({ app }) => {
        setImmediate(() => app.exit(0));
      })
      .catch(() => undefined);
    await application.close();
    await rm(directory, { recursive: true, force: true });
  }
});
