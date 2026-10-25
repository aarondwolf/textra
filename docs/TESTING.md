# Testing

## Standard checks

Run `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`, and `npm run test:e2e`. `npm run dev` opens the native app;
`npm run test:dev` checks renderer HMR and main/preload reload behavior. Run the
development smoke test without concurrent edits because it temporarily changes and
restores probe files.

The development smoke test reloads after attaching renderer error diagnostics so
static module failures are reported even if they occurred before CDP connected.
It selects the renderer page by the local Vite URL when attaching over CDP, and uses
an ephemeral debugging port so a Windows restart does not collide with a socket
still being released by the old Electron process.
Run it after renderer dependency changes: production builds convert CommonJS, but
development uses the explicit `optimizeDeps.include` list in `electron.vite.config.ts`
with discovery disabled. Keep new renderer/shared runtime dependencies in that list,
including ESM packages whose transitive dependencies use CommonJS. The 2026-10-24
parser refactor otherwise served `is-buffer` unconverted, aborting before React mounted
with a missing default export and leaving a blank native window.

## Radix controls and UI visual audit (2026-10-24)

The settings/toolbar follow-up passed `npm test` (71 files, 728 tests), typecheck,
lint, format check, and production build. The final full native Playwright run passed
16 tests with two intentional skips (opt-in live provider and startup measurement).
The Radix screen test captures Editor, Files, Compilation, Shortcuts, LaTeX tools,
AI Settings, Import & export, wide/compact workspace and preview views. Screenshots
were inspected after the final build; see `docs/UI_AUDIT.md`. Initial full-suite
failures exposed Save-button dirty-state handling, fixed and verified by rerunning
both affected workflows before the final full-suite pass.

`tests/e2e/radix-controls.spec.ts` covers recipe and compile control alignment,
Radix radio selection and Escape handling, Settings menu visibility/hit-testing,
light/dark theme switching, and preview switching at a compact window size. It
captures screenshots for wide and compact workspace layouts, Settings in both
themes, the open theme menu, and the compact preview menu. `tests/e2e/chat.spec.ts`
also captures the open model picker and chat history menu. The full native suite
passed 16 tests with 2 opt-in/measurement tests skipped; the chat and Radix specs
also passed targeted reruns after adding these captures. The component inventory
and visual review are recorded in `docs/UI_AUDIT.md`.

Unit tests cover validation and parsers. Service tests use temporary directories for
real filesystem operations. Electron Playwright tests launch the built app; distinguish
mocked provider calls and fixture builds from live AI provider or TeX integrations. The
live Agent test is opt-in with `TEXTRA_LIVE_AI_TEST=1`, uses the saved encrypted Google
key and real quota, and should be run only when explicitly needed. Normal tests do not
send credentials to any provider.

AI SDK provider contracts live in `tests/integration/ai-sdk-providers.test.ts`. They run the
real SDK adapters against a local fixture HTTP server that speaks each provider's streaming
format: bearer/key headers, configured path prefixes, system prompt placement, OpenRouter
routing options, zero retries, sanitized authentication errors, refused redirects, malformed
streams, mid-stream cancellation, and tool/reasoning replay for Chat Completions (DeepSeek
reasoning_content) and Anthropic (thinking signatures). `tests/unit/assistant-runner.test.ts`
and `tests/unit/agent.test.ts` drive the assistant with scripted SDK mock models
(`tests/helpers/scripted-model.ts`): ordinary answers, on-demand reads, multiple ordered
staged edits, recoverable and fatal tool errors, budgets, truncation, unsupported-tool
connections, request validation, review notes, cancellation and invalidated context.
`tests/unit/agent-staging.test.ts` covers the staging operations directly.
`tests/e2e/agent.spec.ts` and `tests/e2e/chat.spec.ts` exercise the unified assistant UI with
mocked assistant IPC; `tests/e2e/completion.spec.ts` checks the streamed Ctrl+I preview.
Assistant regressions verify optional SDK reasoning remains separate from answer text, Google
thought output is requested only for Gemini 2.5/3 model IDs, reasoning stays collapsed and
ephemeral, and fenced code in both user and assistant bubbles has a working copy control.

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

Startup regression tests cover active-first restoration with 50 tabs, missing files,
editing during background restoration, and a validated previous PDF rendered by real
PDF.js without compiling. Run `npm run test:e2e -- tests/e2e/startup.spec.ts` for these
functional checks. `npm run test:startup` runs the opt-in measurement harness, with
isolated synthetic profiles and no live provider calls. See [Performance](PERFORMANCE.md)
for fixture details, timing origins, memory/CPU caveats and recorded results.
Run native tests and measurements after builds and unit/integration checks finish;
concurrent runs can delete shared test fixtures and distort timings.

Architecture regressions cover persisted history schema/path attacks, production-profile
reopening, dirty-buffer restore and backup failure, interrupted legacy recovery, actual
file growth after stat, and Windows history publication locks. Retry tests verify that
external edits and junction swaps are revalidated rather than overwritten. Language
and TexLab tests cover owned stream errors, output/frame bounds, cancellation,
backpressure and queue-saturated shutdown. Document tests cover undoable model
reconciliation, stale formatting, save coalescing and shutdown persistence ordering.

`tests/e2e/document-sessions.spec.ts` uses real Monaco and project IO with only the
optional formatter mocked. `tests/e2e/lifecycle.spec.ts` checks untrusted-window IPC,
new-window denial, a second instance, repeated/cancelled close, pending preference
writes and explicit native consent after crashing its disposable renderer. The crash
test intentionally emits a renderer-process-gone diagnostic. These cases do not
exercise a live AI provider or the user's normal application profile.

## 2026-10-25 Yjs collaboration branch verification

- `npm test -- --cache=false`: 74 files, 736 tests passed. Vitest's default cache
  directory was held busy in the Dropbox checkout, so this run disabled only the
  cache.
- `npm run typecheck`, `npm run lint`, and `npm run format:check`: passed.
- `TEXTRA_PRESERVE_RENDERER_OUTPUT=true npm run build`: passed. The normal build
  could not remove the existing generated renderer assets directory due to a
  Windows/Dropbox `EPERM`; preserve-output mode is supported by the Vite config.
- `npm run test:e2e`: 17 passed, 2 skipped in the serial native suite. Skips are
  opt-in live AI and the startup benchmark. Existing project editing, real compile
  and PDF rendering, editor sessions, lifecycle, shell IPC inventory, and UI cases
  passed. The new `collaboration.spec.ts` case launches two isolated Electron
  profiles against one real shared project folder, publishes an initial Yjs record,
  then verifies saved concurrent changes merge while the receiving profile's local
  typing remains present.
- `npm run test:dev -- --restart-check`: passed native development startup, theme
  interaction, CSS HMR, preload reload, main restart, and preference restoration.
- Focused Yjs, collaboration-storage, policy, and history tests pass 39/39. The
  Yjs coverage checks concurrent update convergence, duplicate delivery, local
  undo isolation, save captures, and discard. Plain-file auto-merge remains
  deliberately deferred; outbox/publication failure injection, delayed-sidecar
  reconciliation, concurrent history-index mutation, and copied-folder tests remain
  open integration gates.

## Remaining gate checks

The 2026-10-24 Electron architecture milestone passed 704 unit/integration tests
in 67 files (67.95s) and the complete serial native suite: 15 passed, 2 intentional
skips (4.1m). The skips are live AI and the separately invoked startup benchmark.
Typecheck, lint, production build, renderer HMR, preload reload and main restart
also passed. The native document case verifies exact gzip recovery buffers after
dirty restore; the project case verifies immediate preference export, conflict
copies, real MiKTeX compilation, SyncTeX and PDF rendering. Final formatting and
run-specific performance evidence are recorded with the milestone memory.

- Cross-platform native checks for macOS/Linux, including compilation and SyncTeX.
- The full Phase 1 file, conflict, editor, compiler, PDF and preview workflows.
- Phase 2 native writing, diagnostics, language-service and toolbar interactions.
- Build the installer and exercise install, upgrade, uninstall and TeX setup on Windows.

The most recent verified counts, environment, exceptions and run-specific evidence are
recorded in `.agents/memory/TESTING.md`.
