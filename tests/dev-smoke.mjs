// Run with no concurrent renderer edits: node tests/dev-smoke.mjs
// Uses the actual electron-vite dev command and restores its temporary CSS probe.
// Add --restart-check to also verify preload reload and main-process restart.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const project = process.cwd();
const results = join(project, '.test-data', 'dev-smoke');
await mkdir(results, { recursive: true });
const viteCache = join(results, 'vite-cache');
await mkdir(viteCache, { recursive: true });
const userData = await mkdtemp(join(results, 'user-data-'));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.ELECTRON_CLI_ARGS;
delete environment.NO_SANDBOX;
environment.TEXTRA_USER_DATA_DIR = userData;
environment.TEXTRA_VITE_CACHE_DIR = viteCache;
// Electron restarts during this smoke test. Port 0 gives each process a fresh
// debug endpoint, avoiding Windows' delayed socket release for a reused port.
environment.REMOTE_DEBUGGING_PORT = '0';

const processUnderTest = spawn(
  process.execPath,
  [resolve('node_modules/electron-vite/bin/electron-vite.js'), 'dev', '--watch'],
  { cwd: project, env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
let output = '';
for (const stream of [processUnderTest.stdout, processUnderTest.stderr]) {
  stream.on('data', (chunk) => {
    output = (output + String(chunk)).slice(-20000);
  });
}
let browser;
let modified = false;
const devtoolsPort = () => {
  const ports = [...output.matchAll(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/g)];
  const latest = ports.at(-1)?.[1];
  return latest ? Number(latest) : null;
};
const restartProbes = new Map();
const stylesheet = join(project, 'src', 'renderer', 'src', 'styles.css');
const marker = `\n/* TeXtra temporary HMR smoke probe */\n:root { --textra-hmr-probe: verified; }\n`;

try {
  await expect
    .poll(
      async () => {
        if (processUnderTest.exitCode !== null) {
          throw new Error(`Development process exited early: ${output}`);
        }
        const port = devtoolsPort();
        if (port === null) return false;
        try {
          browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 });
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 45000, intervals: [250, 500, 1000] },
    )
    .toBe(true);
  const context = browser.contexts()[0];
  const applicationPage = () =>
    context.pages().find((candidate) => candidate.url().startsWith('http://127.0.0.1:5173/'));
  await expect.poll(() => applicationPage() !== undefined, { timeout: 15000 }).toBe(true);
  const page = applicationPage();
  if (!page)
    throw new Error(
      `Native renderer page was not found. CDP pages: ${context
        .pages()
        .map((candidate) => candidate.url())
        .join(', ')}`,
    );
  const rendererErrors = [];
  page.on('pageerror', (error) => {
    rendererErrors.push(error.message);
    console.error(`Renderer startup error: ${error.message}`);
  });
  // Reload after installing diagnostics so static module failures are captured,
  // even when Electron loaded the page before the CDP connection was established.
  await page.waitForLoadState();
  await page.reload();
  await expect(page.getByRole('main', { name: 'Document workspace' })).toBeVisible({
    timeout: 30000,
  });
  expect(rendererErrors, 'Development renderer must load without uncaught errors').toEqual([]);
  await page.getByRole('button', { name: 'Settings and TeX setup', exact: true }).click();
  await page.getByRole('button', { name: 'Theme', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  const sentinel = randomUUID();
  await page.evaluate((value) => {
    window.__textraHmrSmoke = value;
  }, sentinel);
  const original = await readFile(stylesheet, 'utf8');
  await writeFile(stylesheet, original + marker, 'utf8');
  modified = true;
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--textra-hmr-probe').trim(),
        ),
      { timeout: 15000 },
    )
    .toBe('verified');
  expect(await page.evaluate(() => window.__textraHmrSmoke)).toBe(sentinel);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({ path: join(results, 'native-development-window.png') });
  console.log('PASS: native development window, interactive theme, CSS HMR without page reload.');
  if (process.argv.includes('--restart-check')) {
    const appendRestartProbe = async (relativePath) => {
      const filename = join(project, relativePath);
      const probe = `\n// TeXtra temporary restart smoke probe ${randomUUID()}\n`;
      const source = await readFile(filename, 'utf8');
      await writeFile(filename, source + probe, 'utf8');
      restartProbes.set(filename, probe);
    };
    const reload = page.waitForEvent('load', { timeout: 15000 });
    await appendRestartProbe('src/preload/index.ts');
    await reload;
    await expect(page.getByRole('main', { name: 'Document workspace' })).toBeVisible();
    expect(await page.evaluate(() => window.__textraHmrSmoke)).toBeUndefined();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    console.log('PASS: preload rebuild reloads the native renderer.');

    const previousBrowser = browser;
    await appendRestartProbe('src/main/index.ts');
    await expect.poll(() => previousBrowser.isConnected(), { timeout: 15000 }).toBe(false);
    await expect
      .poll(
        async () => {
          const port = devtoolsPort();
          if (port === null) return false;
          try {
            browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 });
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 45000 },
      )
      .toBe(true);
    const restartedContext = browser.contexts()[0];
    await expect.poll(() => restartedContext.pages().length).toBeGreaterThan(0);
    const restartedPage = restartedContext
      .pages()
      .find((candidate) => candidate.url().startsWith('http://127.0.0.1:5173/'));
    if (!restartedPage) {
      throw new Error(
        `Restarted renderer page was not found. CDP pages: ${restartedContext
          .pages()
          .map((candidate) => candidate.url())
          .join(', ')}`,
      );
    }
    await expect(restartedPage.getByRole('main', { name: 'Document workspace' })).toBeVisible();
    await expect(restartedPage.locator('html')).toHaveAttribute('data-theme', 'light');
    console.log('PASS: main rebuild restarts native Electron and restores preferences.');
  }
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (modified) {
    const current = await readFile(stylesheet, 'utf8');
    if (!current.includes(marker)) {
      console.error('HMR marker changed; inspect stylesheet manually.');
      process.exitCode = 1;
    } else {
      // Remove only this script's probe, preserving any unrelated edits.
      await writeFile(stylesheet, current.replace(marker, ''), 'utf8');
    }
  }
  if (browser) {
    await Promise.race([
      (async () => {
        const session = await browser.newBrowserCDPSession();
        await session.send('Browser.close');
      })().catch(() => undefined),
      new Promise((done) => setTimeout(done, 2000)),
    ]);
    await Promise.race([
      browser.close().catch(() => undefined),
      new Promise((done) => setTimeout(done, 2000)),
    ]);
  }
  if (processUnderTest.exitCode === null) {
    await Promise.race([
      new Promise((done) => processUnderTest.once('exit', done)),
      new Promise((done) => setTimeout(done, 3000)),
    ]);
  }
  if (processUnderTest.exitCode === null) processUnderTest.kill();
  for (const [filename, probe] of restartProbes) {
    const current = await readFile(filename, 'utf8');
    if (!current.includes(probe)) {
      console.error(`Restart probe changed; inspect ${filename} manually.`);
      process.exitCode = 1;
    } else {
      await writeFile(filename, current.replace(probe, ''), 'utf8');
    }
  }
  await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
