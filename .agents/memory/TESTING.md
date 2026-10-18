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
