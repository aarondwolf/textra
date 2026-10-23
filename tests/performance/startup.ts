import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { DEFAULT_PREFERENCES } from '../../src/shared/api';

export async function closeStartupApplication(application: ElectronApplication) {
  // Bound teardown of this disposable test process, including a native close
  // dialog during a failed assertion. Never search for or stop other processes.
  const timer = setTimeout(() => application.process().kill(), 10000);
  try {
    await application.evaluate(({ dialog }) => {
      // Only disposable fixture documents can be dirty here, after a failed test.
      dialog.showMessageBoxSync = () => 1;
    });
    await application.close();
  } finally {
    clearTimeout(timer);
  }
}

function fixturePdf(): Buffer {
  const content = 'BT /F1 16 Tf 30 80 Td (Startup fixture) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export async function createStartupFixture(
  tabCount: number,
  missingActive = false,
  withPdf = false,
  profileLocation: 'workspace' | 'os-temp' = 'workspace',
) {
  const parent = join(process.cwd(), '.test-data', 'startup-profiles');
  if (profileLocation === 'os-temp' && /[\\/]Dropbox(?:[\\/]|$)/i.test(tmpdir()))
    throw new Error(
      'The OS temporary directory is inside Dropbox; refusing an unsynced-profile claim.',
    );
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'case-'));
  const root = join(directory, 'project');
  const profile =
    profileLocation === 'os-temp'
      ? await mkdtemp(join(tmpdir(), 'textra-startup-profile-'))
      : join(directory, 'profile');
  await mkdir(root);
  if (profileLocation === 'workspace') await mkdir(profile);
  const paths = Array.from({ length: tabCount }, (_, index) => `document-${index + 1}.tex`);
  await Promise.all(
    paths.map((path) =>
      writeFile(
        join(root, path),
        `\\documentclass{article}\n\\begin{document}\n${path}\n\\end{document}\n`,
      ),
    ),
  );
  const recentId = randomUUID();
  await writeFile(
    join(profile, 'recent-projects.json'),
    JSON.stringify({
      version: 1,
      projects: [{ id: recentId, name: 'Startup fixture', rootPath: root, pinned: false }],
    }),
  );
  await writeFile(
    join(profile, 'preferences.json'),
    JSON.stringify({ ...DEFAULT_PREFERENCES, restoreSession: true, texlabEnabled: false }),
  );
  if (withPdf) {
    // A deterministic PDF and matching main-owned cache metadata model a previous
    // successful build. No TeX process is run to create this synthetic artifact.
    const bytes = fixturePdf();
    const path = 'document-1.pdf';
    await writeFile(join(root, path), bytes);
    const info = await lstat(join(root, path), { bigint: true });
    await mkdir(join(profile, 'last-pdfs'));
    await writeFile(
      join(profile, 'last-pdfs', `${createHash('sha256').update(root).digest('hex')}.json`),
      JSON.stringify({
        schemaVersion: 1,
        root,
        rootFile: paths[0],
        path,
        recipeId: null,
        compiledAt: '2026-10-23T00:00:00.000Z',
        fingerprint: `${info.ino}:${info.size}:${info.mtimeNs}`,
        digest: createHash('sha256').update(bytes).digest('hex'),
      }),
    );
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TEXTRA_USER_DATA_DIR = profile;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NO_SANDBOX;
  delete env.ELECTRON_CLI_ARGS;
  const launch = async () => {
    const application = await electron.launch({ args: ['.'], env, timeout: 45000 });
    application
      .process()
      .stdout?.on('data', (data: Buffer) =>
        console.info(`[startup main stdout] ${data.toString()}`),
      );
    application
      .process()
      .stderr?.on('data', (data: Buffer) =>
        console.info(`[startup main stderr] ${data.toString()}`),
      );
    const observePage = (page: Page) => {
      page.on('pageerror', (error) =>
        console.error(`[startup renderer pageerror] ${error.message}`),
      );
      page.on('console', (message) => {
        if (message.type() === 'error')
          console.error(`[startup renderer console] ${message.text()}`);
      });
    };
    application.context().on('page', observePage);
    application.context().pages().forEach(observePage);
    return application;
  };
  // Populate Chromium's actual localStorage origin, without touching any real profile.
  const setup = await launch();
  if (process.env.TEXTRA_STARTUP_BENCHMARK === '1')
    console.info('Startup benchmark: setup process attached.');
  try {
    const page = await setup.firstWindow({ timeout: 45000 });
    await expect(page.getByRole('main', { name: 'Document workspace' })).toBeVisible();
    if (process.env.TEXTRA_STARTUP_BENCHMARK === '1')
      console.info('Startup benchmark: setup shell visible.');
    await page.evaluate(
      (session) => localStorage.setItem('textra:workspace-session', JSON.stringify(session)),
      {
        recentId,
        projectId: recentId,
        paths: missingActive ? [...paths, 'missing.tex'] : paths,
        activePath: missingActive ? 'missing.tex' : paths.at(-1),
      },
    );
  } finally {
    if (process.env.TEXTRA_STARTUP_BENCHMARK === '1')
      console.info('Startup benchmark: closing setup.');
    await closeStartupApplication(setup);
  }
  return {
    root,
    paths,
    launch,
    profileLocation,
    cleanup: async () => {
      const removeOwnedDirectory = async (target: string, allowedParent: string) => {
        const within = relative(resolve(allowedParent), resolve(target));
        if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within))
          throw new Error('Refusing startup fixture cleanup outside its expected parent.');
        await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
      };
      if (profileLocation === 'os-temp') await removeOwnedDirectory(profile, tmpdir());
      await removeOwnedDirectory(directory, parent);
    },
  };
}

export async function observeStartup(launch: () => Promise<ElectronApplication>, settle = false) {
  const started = performance.now();
  const launchEpochMs = Date.now();
  const progress = (message: string) => {
    if (process.env.TEXTRA_STARTUP_BENCHMARK === '1') console.info(`Startup benchmark: ${message}`);
  };
  const application = await launch();
  progress('process attached');
  try {
    const page = await application.firstWindow({ timeout: 45000 });
    await expect(page.getByRole('main', { name: 'Document workspace' })).toBeVisible();
    const shellObservedMs = performance.now() - started;
    progress('shell visible');
    const editor = page.getByRole('textbox', { name: 'LaTeX source editor' });
    await expect(editor).toBeVisible({ timeout: 30000 });
    await expect
      .poll(async () => (await page.locator('.source-editor').boundingBox())?.height ?? 0)
      .toBeGreaterThan(200);
    await editor.focus();
    const editorObservedMs = performance.now() - started;
    progress('editor visible');
    await expect(
      page.getByRole('button', { name: 'Compile active document', exact: true }),
    ).toBeEnabled();
    const compileEnabledObservedMs = performance.now() - started;
    // Buffered long tasks include startup work before Playwright attached. A missing
    // implementation is explicit; an empty list does not imply unsupported measurement.
    const longTasks = await page.evaluate(async () => {
      if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return null;
      return await new Promise<Array<{ startTime: number; duration: number }>>((resolve) => {
        const entries: Array<{ startTime: number; duration: number }> = [];
        const observer = new PerformanceObserver((list) => {
          entries.push(
            ...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })),
          );
        });
        observer.observe({ type: 'longtask', buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(entries);
        }, 0);
      });
    });
    // Prime CPU deltas; a single first call reports zero by definition.
    await application.evaluate(({ app }) => {
      app.getAppMetrics();
    });
    if (settle) await page.waitForTimeout(2000);
    const processes = await application.evaluate(({ app }) =>
      app.getAppMetrics().map(({ type, cpu, memory }) => ({ type, cpu, memory })),
    );
    progress('process metrics collected');
    let compileDispatchObservedMs: number | null = null;
    if (settle) {
      // Explicitly mocked subprocess execution: retain the renderer save/config
      // path and typed IPC dispatch without requiring a TeX installation.
      await application.evaluate(({ ipcMain }) => {
        const state = globalThis as typeof globalThis & { startupCompileReceived?: boolean };
        state.startupCompileReceived = false;
        ipcMain.removeHandler('textra:build:compile');
        ipcMain.handle('textra:build:compile', () => {
          state.startupCompileReceived = true;
          return {
            ok: false,
            code: 'NOT_FOUND',
            error: 'Startup benchmark: TeX execution mocked.',
          };
        });
      });
      const clicked = performance.now();
      await page.getByRole('button', { name: 'Compile active document', exact: true }).click();
      await expect
        .poll(() =>
          application.evaluate(
            () =>
              (globalThis as typeof globalThis & { startupCompileReceived?: boolean })
                .startupCompileReceived,
          ),
        )
        .toBe(true);
      compileDispatchObservedMs = performance.now() - clicked;
    }
    const marks = await page.evaluate(() =>
      performance
        .getEntriesByType('mark')
        .filter(({ name }) => name.startsWith('textra:'))
        .map(({ name, startTime }) => ({ name, startTime })),
    );
    const rendererTimeOriginEpochMs = await page.evaluate(() => performance.timeOrigin);
    const rendererLoading = await page.evaluate(() => {
      const navigation = window.performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined;
      return {
        navigation: navigation
          ? {
              type: navigation.type,
              duration: navigation.duration,
              fetchStart: navigation.fetchStart,
              requestStart: navigation.requestStart,
              responseStart: navigation.responseStart,
              responseEnd: navigation.responseEnd,
              domInteractive: navigation.domInteractive,
              domContentLoadedEventStart: navigation.domContentLoadedEventStart,
              domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
              loadEventStart: navigation.loadEventStart,
              loadEventEnd: navigation.loadEventEnd,
              transferSize: navigation.transferSize,
              encodedBodySize: navigation.encodedBodySize,
              decodedBodySize: navigation.decodedBodySize,
            }
          : null,
        resources: performance
          .getEntriesByType('resource')
          .slice(0, 250)
          .map((entry) => {
            const resource = entry as PerformanceResourceTiming;
            return {
              // Keep asset identity without recording absolute local filesystem paths.
              asset:
                new URL(resource.name).protocol === 'data:'
                  ? 'inline-data'
                  : new URL(resource.name).pathname.split('/').at(-1),
              protocol: new URL(resource.name).protocol,
              initiatorType: resource.initiatorType,
              startTime: resource.startTime,
              duration: resource.duration,
              workerStart: resource.workerStart,
              fetchStart: resource.fetchStart,
              requestStart: resource.requestStart,
              responseStart: resource.responseStart,
              responseEnd: resource.responseEnd,
              transferSize: resource.transferSize,
              encodedBodySize: resource.encodedBodySize,
              decodedBodySize: resource.decodedBodySize,
            };
          }),
        paintEntries: window.performance
          .getEntriesByType('paint')
          .map(({ name, startTime }) => ({ name, startTime })),
        visibilityAtObservation: document.visibilityState,
      };
    });
    return {
      application,
      page,
      elapsedSinceLaunch: () => performance.now() - started,
      report: {
        shellObservedMs,
        editorObservedMs,
        compileEnabledObservedMs,
        compileClickObservedMs: compileDispatchObservedMs,
        launchEpochMs,
        rendererTimeOriginEpochMs,
        rendererMarkLaunchElapsedMs: marks.map(({ name, startTime }) => ({
          name,
          elapsedMs: rendererTimeOriginEpochMs + startTime - launchEpochMs,
        })),
        // Marks are relative to renderer navigation, observed times to electron.launch().
        rendererMarks: marks,
        rendererLongTasks: longTasks,
        rendererLoading,
        processMetricsAfterSettle: processes,
        settleMs: settle ? 2000 : 0,
        pdfReady: marks.some(({ name }) => name === 'textra:pdf-ready'),
        compileDispatched: marks.some(({ name }) => name === 'textra:compile-dispatch'),
      },
    };
  } catch (error) {
    await closeStartupApplication(application);
    throw error;
  }
}

export async function rendererBundleSizes() {
  const html = await readFile(join(process.cwd(), 'out', 'renderer', 'index.html'), 'utf8');
  const entry = /<script[^>]*src="([^"]+)"/.exec(html)?.[1];
  const directory = join(process.cwd(), 'out', 'renderer', 'assets');
  const files = await readdir(directory);
  const javascript = await Promise.all(
    files
      .filter((file) => /\.m?js$/.test(file))
      .map(async (file) => ({
        file,
        bytes: (await stat(join(directory, file))).size,
      })),
  );
  return { entry, javascript };
}
