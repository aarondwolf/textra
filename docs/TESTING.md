# Testing

## Standard checks

Run `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, and `npm run test:e2e`. `npm run dev` opens the native app;
`npm run test:dev` checks renderer HMR and main/preload reload behavior. Run the
development smoke test without concurrent edits because it temporarily changes and
restores probe files.

Unit tests cover validation and parsers. Service tests use temporary directories for
real filesystem operations. Electron Playwright tests launch the built app; distinguish
mocked provider calls and fixture builds from live AI provider or TeX integrations. The
live Agent test is opt-in with `TEXTRA_LIVE_AI_TEST=1`, uses the saved encrypted Google
key and real quota, and should be run only when explicitly needed. Normal tests do not
send credentials to any provider.

Run Playwright suites serially on Windows: parallel runs can clean shared profiles and
traces. The managed desktop test environment needs elevated filesystem access for
junction and MiKTeX registry checks. No installer, cross-platform or TeX check should
be reported as passing unless it was run on the relevant platform and distribution.

## Remaining gate checks

- Cross-platform native checks for macOS/Linux, including compilation and SyncTeX.
- The full Phase 1 file, conflict, editor, compiler, PDF and preview workflows.
- Phase 2 native writing, diagnostics, language-service and toolbar interactions.
- Build the installer and exercise install, upgrade, uninstall and TeX setup on Windows.

The most recent verified counts, environment, exceptions and run-specific evidence are
recorded in `.agents/memory/TESTING.md`.
