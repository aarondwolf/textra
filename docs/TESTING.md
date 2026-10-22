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

Inline completion has parser, editor-coordinator, settings migration/consent and
provider contract tests. `tests/e2e/completion.spec.ts` uses real Monaco/project IO
with explicitly mocked AI/build IPC: automatic opt-in and quiet prose, prompted
Ctrl+I with no request before submit, multiline instruction typing, selected-range
diff/replacement, insertion ghost text, stale cancellation, equation/literal
automatic suggestions, Tab/Escape, one-step Undo and Ctrl+Enter without a newline.
Provider regressions cover multiline automatic output through ten lines, manual
output through twenty, CRLF preservation, streamed line-budget cancellation and
early termination on an echoed suffix. Verify prose does not open generic word or
TexLab suggestions, while command/structured-argument completion remains available.
Run `node tests/manual/ai-completion-live.mjs --run` only for an explicitly requested
live check against already configured local Qwen, Mistral/Codestral and Google.
It sends synthetic fixture text through the real main service and reports model,
transport, latency and response bounds without printing keys or source. Optional
`--provider=ollama-local` limits that check. It never pulls models or changes keys;
it refreshes configured catalogues. Missing credentials, decryption failures and
timeouts are live limitations, not mocked successes.
`--automatic` uses the already saved automatic model/consent and never enables it.
`--inline-edit` exercises the new prompted-edit request and shared instructions;
without it, the helper probes the continuation/FIM adapter. Disabled providers are skipped.
`--figure` tests a synthetic TikZ supply/demand comment followed by an open
environment. On 2026-10-21, real Qwen2.5-Coder0.5B automatic completion returned
four lines/836 characters in 13.669s before the prompted-edit redesign. Current
verification counts and limitations are recorded in `.agents/memory/TESTING.md` and
`.agents/memory/AI_SETTINGS_IMPLEMENTATION.md`.
TexLab has mocked protocol/adapter regressions plus a Windows bundled-process
integration test exercising unchanged syncs and a burst of real editor requests.

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
