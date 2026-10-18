# Testing

Initial host: Windows, Node 24.14.0, npm 11.9.0. MiKTeX executables are on PATH;
their presence alone does not prove usable package installations.

Verification scripts: `npm run format:check`, `npm run typecheck`, `npm run lint`,
`npm test`, `npm run build`, `npm run test:e2e`. `npm run dev` must open Electron
and update renderer content without reopening the window. Main/preload watch mode
restarts/reloads when those files change.

Unit tests cover validation/parsers. Service integration tests use temporary
directories and exercise conflicts/path safety. Electron Playwright tests launch
the real built executable. Real TeX smoke tests must be explicitly distinguished
from fixtures/mocks and skip with a reason when executables are unavailable.

Fixtures will include minimal/multi-file documents, bibliography, figures,
malformed TeX, Beamer, TikZ, Unicode and space paths, and citation edge cases.
Generated outputs go to ignored build folders. No install/uninstall or cross-OS
test may be claimed without running it. Evidence is in .agents/memory/TESTING.md.

`npm run test:dev` launches native electron-vite, checks HMR, and verifies
main/preload restart behavior. Run without concurrent source edits. It restores
temporary probes and stores a screenshot under ignored .test-data/dev-smoke.

Core tests use actual MiKTeX/BibTeX/latexmk and two-way SyncTeX when installed,
explicit skips otherwise. No real core integrations were skipped on this host.
Native workflow stubs only chooser/confirmation destinations; files, editor, IPC,
compiler, PDF.js, settings and conflict recovery are real. Junction tests require
desktop filesystem permissions in this managed environment. See memory evidence.

Vite's mutable cache is placed in the OS temp directory, keyed by checkout path,
to avoid Dropbox/OneDrive directory locks. Dev checks must run without formatting
or source edits; they intentionally mutate and restore probes. Shell E2E allows
90 seconds for two real Windows launches plus profile cleanup.
