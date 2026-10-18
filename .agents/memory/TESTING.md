# Test evidence

2026-10-18 Windows: Node v24.14.0, npm 11.9.0; Git present. MiKTeX
pdflatex/xelatex/lualatex/latexmk/bibtex/biber/synctex found on PATH.
MiKTeX 25.12 (pdfTeX4.23), Git2.52.0.windows.1, Electron44.9.0,
electron-vite6, Vite8.3.4, React19.3.1, TypeScript6.0.3; exact lockfile pinned.

Foundation: format/typecheck/lint/build pass; 45 unit/service tests pass in sandbox.
Native Playwright passed 1 test (8.9s) covering isolated renderer, palette,
theme/sidebar/panel actions and persistence after relaunch. CSS HMR smoke passed
with runtime sentinel preserved, exit0. Main/preload restart checks added, pending.

Resolved test issues: sandbox temporary rename EPERM (use workspace test-results),
initial Electron binary download timeout, palette accessible name, Windows LevelDB
cleanup lock (bounded retries), CDP close unresolved promise (bounded cleanup).
Dependency audit reported zero vulnerabilities after DOMPurify patch override.

Expanded native restart test passed exit0: CSS HMR, preload renderer reload, main restart with persisted theme. CDP reconnect allowed bounded 5s attempts within 45s for Windows startup.

Core IDE: 138/138 tests in12 files pass approved desktop execution (28.25s).
Real builds: Unicode/space article, multi-file dissertation + bibliography/table/
figure, malformed input preserving last PDF, actual process cancellation, 3s
timeout, latexmk ignoring project rc, and two-way SyncTeX including chapters.
Settings35 tests cover schemas, preservation and real junctions. Workspace6 tests
exercise delayed I/O, tab-cap races, explicit discard and dirty-state synchronization.
Native workflow passed39.2s: actual Monaco edit/save, external conflict/copy/reload,
BibTeX build, nonblank PDF pixels/pages, config/export, setup compile, unsaved
cancel/discard/reopen and persisted compiler. OS chooser destinations are stubbed.

Review fixes: counted operations/read-only editor, delayed reload compares captured
project/content/revision, tab cap checked after I/O, rename/delete reconcile root,
and Save All waits for main dirty state. Monaco uses supported textarea mode;
keyboard tests focus it because rendering overlays intercept pointer clicks.

Final native suite: 2/2 passed (project37.8s; shell56.1s, total1.6min), including
real settings import restoring theme and PDF text search. Shell includes two
Windows launches and uses bounded90s; a45s timeout was insufficient on this host.
Dev cache: synced node_modules/.vite directory replacement failed twice with
EBUSY; moving cache to OS temp fixed startup and all reload assertions. One run
was invalidated by concurrent formatting of its probe; restored and rerun alone.
Clean final dev smoke passed exit0 with all three reload assertions and probes
restored. Final format:check, typecheck, lint, production build and diff checks pass.
