# Testing

2026-10-20 shared models and suggested-fix handoff: 418 unit/integration tests pass
across 32 files; production build, typecheck, targeted lint and formatting pass.
Mocked official SDK tests exercise all seven models for Chat and Agent, with 3.5
Flash Lite the shared default. Suggestion-label tests cover actionable Markdown,
empty labels and code fences. Native Chat/Agent checks pass for completed-response
handoff, prior conversation/context, default routing, once-only notice fade and
profile restart, and existing review safety. Native shell smoke passes. Opt-in live
Gemini 3.5 Flash Lite stages both lipsum package insertion and original-line replacement
and passes sequential approvals without disk changes. Initial live runs exposed
invalid guessed insertion columns; explicit Unicode endColumn metadata and precise
tool-error bounds fixed this within the unchanged bounded call budget. Live and
mocked provider evidence remain separate; normal tests do not consume Google quota.

2026-10-20 sequential review fix: 82 focused agent/workspace tests pass. The full
386-test run passed 385 initially; one unrelated preferences fixture hit Windows
EBUSY during temporary-directory cleanup, then all six preferences tests passed on
rerun. Typecheck, targeted lint/format and production build pass (generated-assets
EPERM resolved on retry). Live Gemma 4 26B staged both lipsum package insertion and
replacement of original line 28 in one proposal; sequential review/echo/approval
passed without changing disk. Native review passes immediate individual apply/skip,
remaining-hunk advancement, final dismissal, Approve all, Undo and stale approval/file
guards. Native chat/history and shell security checks pass. Mock agent setup waits for
the first window before replacing handlers, avoiding duplicate-handler startup races.

2026-10-20 bounded Agent follow-up: 377 unit/integration tests passed. Final targeted
agent/workspace regression rerun passed73 tests; canonical history rerun passed4.
SDK tests cover omitted zero-arg read arguments, line/column lorem ipsum insertion,
unique expected-text replacement, bounded tool-error correction, staged verification
reads at the three-call cap, prior-chat handoff and approved-hunk subsets.
History tests use real temporary files for restart/reopen isolation, queued old-scope saves,
latest-snapshot ordering, malformed history preservation and transcript bounds.
Native chat checks immediate model menus, Ctrl+Enter, preserved mode conversations,
history restore/archive and compact send controls. Native word selection checks cumulative
left/right selection in both directions. Native shell security smoke passes.
Opt-in live `tests/e2e/agent-live.spec.ts` passed with the saved encrypted Google key:
Gemma4 26B proposed and main accepted exactly a lorem ipsum insertion in a temporary
active `.tex` snapshot; disk contents stayed unchanged. Normal runs skip this test unless
`TEXTRA_LIVE_AI_TEST=1`. Windows fixture copies only OS-encrypted `os_crypt` metadata
into an isolated profile, never plaintext credentials or the rest of the app profile.
Mocked native agent review remains separate from this live-provider boundary test.
Final native inline review passes read-only preview, per-hunk approve/reject, partial
buffer-only application, Undo, stale response suppression, .md rejection and external
change invalidation. Existing external-conflict modal is explicitly resolved by closing
the buffer in the fixture; neither version is overwritten.
Production build/typecheck/lint pass. Windows sometimes locks generated renderer assets;
an immediate build retry passes. Unrelated sandbox/issues.md still prevents global format
check; changed task files are checked separately. Earlier full-project workflow selector
limitations below are unchanged; this slice does not close remaining roadmap gates.

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

External-change matrix: verify atomic replacement with dirty local text, repeated external writes,
clean local text, enabled autosave, rename/delete, conflict-name collisions, a Dropbox/network
folder with polling-only enabled, and the read-only diff after the external file is stable. Unit
coverage verifies collision-safe snapshots and polling detection; native interaction checks remain
required for dialog timing and Monaco rendering.

Vite's mutable cache is placed in the OS temp directory, keyed by checkout path,
to avoid Dropbox/OneDrive directory locks. Dev checks must run without formatting
or source edits; they intentionally mutate and restore probes. Shell E2E allows
90 seconds for two real Windows launches plus profile cleanup.

Gemini chat: `tests/unit/gemini.test.ts` verifies persistence using an authenticated AES
test cipher and tests the real official SDK against a stubbed fetch boundary. It checks
the fixed Google URL/model, key header, no tool configuration, bounded inputs/output,
safe provider errors, failed-key preservation, and cancellation/concurrency. This is
not a live Google credential/quota test. The native `tests/e2e/chat.spec.ts` launches
real Electron and mocks AI IPC responses for onboarding/settings/history/loading,
rate-limit retry, and cancellation. Its Problems workflow uses a real temporary project
and mocks the compile result/state to verify bounded editable drafts, default no-send,
and explicit auto-send. No live key is needed or transmitted by tests.

Streaming chat coverage uses real SDK SSE parsing with mocked fetch chunks, including
cumulative text before completion, output caps, midstream errors, and cancellation.
The native chat fixture emits correlated IPC chunks and checks Markdown formatting
before completion, stale-chunk rejection, retry context, intro dismissal, compact send circle,
minimal scrolling chrome, and chat rail placement. Key tests remain nonstreaming.
The streamed Markdown screenshot is reviewed for typography and code/list formatting;
chat explicitly restores list markers that the app-wide CSS reset otherwise removes.
Single-key management tests cover atomic replacement, failed replacement preservation,
deletion/reset/restart, removal without OS decryption, concurrent-operation rejection,
and corrupt settings preservation. Native chat checks Replace/Cancel, failed/successful
replacement, cancelled/confirmed deletion and reconfiguration; the native shell checks
that the real delete handler prompts and returns null when its dialog is cancelled.
Composer coverage checks two text rows, an inset disabled/truncating model selector,
and the circular send control's empty/accent states. Response coverage verifies full-width
unboxed Markdown and copying exact raw Markdown through a mocked clipboard-write boundary.

2026-10-20 validation note: run native checks serially with desktop permissions in this
managed Windows environment. Parallel Playwright invocations clean shared profiles/traces;
sandboxed tests cannot create junctions or access MiKTeX registry settings. The existing
project-workflow test still expects an old external-change banner at line 108; the current
working tree displays the newer conflict dialog. Shell and recipe workflows pass serially.
Final Gemini slice evidence: 276 tests across 27 unit/integration files passed; production
build, typecheck, targeted lint/format, native chat (including Problems auto-send), shell,
and recipe checks passed. Global format still flags user-owned sandbox/issues.md; global
lint retains the existing PdfViewer dependency warning. No live Google API call was tested.
