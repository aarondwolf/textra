import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cpus, release, totalmem } from 'node:os';
import { expect, test } from '@playwright/test';
import {
  closeStartupApplication,
  createStartupFixture,
  observeStartup,
  rendererBundleSizes,
} from '../performance/startup';

test('restores the active document and all 50 saved tabs without losing edits', async () => {
  test.setTimeout(120000);
  const fixture = await createStartupFixture(50);
  try {
    const { application, page } = await observeStartup(fixture.launch);
    try {
      await expect(
        page.getByRole('tab', { name: 'Edit document-50.tex', exact: true }),
      ).toHaveAttribute('aria-selected', 'true');
      const editor = page.getByRole('textbox', { name: 'LaTeX source editor' });
      await editor.focus();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
      await page.keyboard.insertText('% Edited immediately after restoration.\n');
      await expect(page.locator('.source-editor')).toContainText('Edited immediately');
      const save = page.getByRole('button', { name: 'Save file', exact: true });
      await expect(save).toBeEnabled();
      await save.click();
      await expect
        .poll(async () => ({
          disk: await readFile(join(fixture.root, 'document-50.tex'), 'utf8'),
          errors: await page.locator('.workspace-error').allTextContents(),
          saveEnabled: await save.isEnabled(),
          activeTab: await page.getByRole('tab', { selected: true }).allTextContents(),
        }))
        .toMatchObject({ disk: expect.stringContaining('Edited immediately') });
      await expect(page.getByRole('tab', { name: /^Edit document-\d+\.tex$/ })).toHaveCount(50, {
        timeout: 30000,
      });
    } finally {
      await closeStartupApplication(application);
    }
  } finally {
    await fixture.cleanup();
  }
});

test('a missing saved active file restores an available document', async () => {
  test.setTimeout(90000);
  const fixture = await createStartupFixture(2, true);
  try {
    const { application, page } = await observeStartup(fixture.launch);
    try {
      await expect(page.getByRole('tab', { name: 'Edit missing.tex', exact: true })).toHaveCount(0);
      await expect(page.getByRole('tab', { name: /^Edit document-\d+\.tex$/ })).toHaveCount(2);
    } finally {
      await closeStartupApplication(application);
    }
  } finally {
    await fixture.cleanup();
  }
});

test('restores the last valid PDF alongside the editable source without compiling', async () => {
  test.setTimeout(90000);
  const fixture = await createStartupFixture(1, false, true);
  try {
    const { application, page, report, elapsedSinceLaunch } = await observeStartup(fixture.launch);
    try {
      const canvas = page.locator('canvas[aria-label="PDF page 1"]');
      await expect(canvas).toBeVisible({ timeout: 20000 });
      await expect
        .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width))
        .toBeGreaterThan(0);
      const pdfObservedMs = elapsedSinceLaunch();
      await expect(page.getByText('Last compiled', { exact: false })).toBeVisible();
      const marks = await page.evaluate(() =>
        performance
          .getEntriesByType('mark')
          .filter(({ name }) => name.startsWith('textra:'))
          .map(({ name, startTime }) => ({ name, startTime })),
      );
      expect(marks.some(({ name }) => name === 'textra:compile-dispatch')).toBe(false);
      const path = test.info().outputPath('pdf-startup-observation.json');
      await writeFile(
        path,
        JSON.stringify(
          {
            ...report,
            pdfReady: true,
            pdfObservedMs,
            rendererMarks: marks,
            fixture:
              'Synthetic cached PDF, real main validation and PDF.js rendering; no TeX execution.',
          },
          null,
          2,
        ),
      );
      await test
        .info()
        .attach('pdf-startup-observation', { path, contentType: 'application/json' });
    } finally {
      await closeStartupApplication(application);
    }
  } finally {
    await fixture.cleanup();
  }
});

test('startup benchmark reports native process observations', async () => {
  test.skip(process.env.TEXTRA_STARTUP_BENCHMARK !== '1', 'Opt-in performance measurement.');
  test.setTimeout(180000);
  console.info('Startup benchmark: preparing isolated profile.');
  const profileLocation =
    process.env.TEXTRA_STARTUP_PROFILE_LOCATION === 'os-temp' ? 'os-temp' : 'workspace';
  const fixture = await createStartupFixture(1, false, false, profileLocation);
  const samples = [];
  try {
    for (let index = 0; index < 3; index++) {
      console.info(`Startup benchmark: measuring launch ${index + 1}.`);
      const { application, report } = await observeStartup(fixture.launch, true);
      try {
        samples.push({ launch: index + 1, ...report });
      } finally {
        await closeStartupApplication(application);
      }
      console.info(`Startup benchmark: completed launch ${index + 1}.`);
    }
    const report = {
      measuredAt: new Date().toISOString(),
      platform: process.platform,
      architecture: process.arch,
      host: {
        cpuModel: cpus()[0]?.model,
        logicalCpuCount: cpus().length,
        memoryBytes: totalmem(),
        osRelease: release(),
        nodeVersion: process.version,
      },
      profile: 'Isolated synthetic one-file session, AI unconfigured and TexLab disabled.',
      profileStorage:
        fixture.profileLocation === 'os-temp'
          ? 'OS temporary directory outside the workspace'
          : 'Workspace .test-data directory under Dropbox',
      projectStorage: 'Workspace .test-data project under Dropbox',
      cacheState: 'Same profile after one setup launch; OS caches not reset.',
      timingOrigin: 'Observed timings: before electron.launch(); renderer marks: navigation start.',
      limitations:
        'No compiled PDF fixture. Compile dispatch uses real UI/IPC with mocked subprocess execution. CPU is Electron process-metric sampling, not a system profiler.',
      bundle: await rendererBundleSizes(),
      samples,
    };
    const path = test
      .info()
      .outputPath(
        profileLocation === 'os-temp'
          ? 'startup-benchmark-unsynced-profile.json'
          : 'startup-benchmark.json',
      );
    await writeFile(path, JSON.stringify(report, null, 2));
    await test.info().attach('startup-benchmark', { path, contentType: 'application/json' });
  } finally {
    await fixture.cleanup();
  }
});
