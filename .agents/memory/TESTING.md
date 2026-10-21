# Test evidence

2026-10-21 text-model discovery and Mistral/DeepSeek: full Windows suite covered
411 cases: 410 passed initially, one real BibTeX pipeline hit its existing 15s
deadline during concurrent build load. Serial rerun of latex.test.ts passes all
7 cases. Final focused provider/service tests pass 54/54 after tightening cached
default validation; earlier Agent/provider/service run passes 124/124. All seven
Chat routes are tested for identical system text at service and HTTP boundaries.
Discovery fixtures cover output modalities, Mistral chat capabilities, Ollama custom
embedding names/metadata fallback, and cache/default cleanup without key/network
changes. Mistral/DeepSeek fixed URLs, auth, streaming, token fields and DeepSeek
tool-reasoning replay are mocked; no live keys/provider quota used.
Native Chat (32.4s) and shell (1.1m) pass serially; all seven setup cards checked,
Mistral/DeepSeek password/link/save controls verified, onboarding screenshot reviewed.
Typecheck/lint and final production build pass (transient Windows output lock
resolved on retry). Changed-file formatting passes; global format check flags only
untouched docs/ROADMAP.md and sandbox/issues.md. No phase gates advanced.
Launch: npm run dev.

2026-10-21 UI consistency/Agent budget: Windows unit/integration 391/391 pass
with normal permissions, including real MiKTeX and filesystem boundary checks.
Sandbox first run: 368 pass/22 fail/1 skip due to denied hard links, junctions
and MiKTeX registry access; normal-permission rerun resolves all failures.
Typecheck, lint, production build and changed-file Prettier pass. Global
format:check flags only untouched docs/ROADMAP.md and sandbox/issues.md.
Agent regression covers three sequential replacements plus reads/summary over
eight responses, finalization on response 24, remaining-budget feedback, and
discarding staging on response/tool/source/output cap exhaustion. Provider calls
are mocked; no live credentials/quota used. Existing opt-in live test skipped.
Native Agent, word selection, recipes, shell and new ui-consistency checks pass.
Reviewed native dark/light Appearance, Symbols, Snippets and Agent review PNGs.
The border assertion allows Chromium device-pixel snapping on scaled Windows
displays. Shell's bridge allowlist was brought current with existing deleteAIChat.
Native project-workflow still fails its known obsolete external-change banner
expectation; the current UI
correctly presents External change detected instead. Chat's scrollbar assertion
was updated to check the new shared 5px Chromium scrollbar; its history selector
now distinguishes the open-chat item from the existing delete-chat item. Final
native Chat rerun passes (27.3s). Combined native evidence: six passing workflows,
one known stale project-workflow failure, one opt-in live-provider skip. No roadmap
gate advanced. Launch: npm run dev.

2026-10-20 shared defaults/handoff: all 418 tests across 32 unit/integration files
pass. Production build, typecheck, targeted ESLint and task formatting pass. Mocked
SDK coverage routes all seven allowed models in both modes and rejects unknown IDs;
16 suggestion-label cases exclude code fences and incomplete labels. Native Chat,
Agent and shell pass serially. Agent native covers explicit suggested-fix handoff
with prior response/active context/default 3.5, once-only fading notice across mode,
workspace and restart, and the existing review/conflict guards. A fixture assertion
was corrected to expect the intentionally disabled non-.tex input. Two initial live
3.5 attempts exhausted the bounded call budget through repeated invalid insertion
columns. Added explicit endColumn read metadata and precise correctable bounds, plus
a regression test. Final opt-in live Gemini 3.5 Flash Lite test passes both lipsum
edits and sequential review with unchanged disk. No credential output; temporary
fixture-only provider tracing was removed. Launch npm run dev. No phase gates advanced.

2026-10-20 sequential review: backend82/82 pass; full386 cases covered after retrying
an unrelated EBUSY preferences fixture cleanup (385 initial passes,6/6 rerun).
Typecheck/lint/task-format/build pass. Live Gemma 4 26B successfully staged both
lipsum edits and accepted them sequentially, leaving disk unchanged. Native immediate
approval/skip, next-change advancement, final dismissal, Approve all, Undo, stale
review reply, .tex scope and external conflict checks pass (26.6s). Native chat and
shell pass. Startup mocks now wait for firstWindow before replacing IPC handlers.
Launch npm run dev; remaining roadmap gates and unrelated dirty files preserved.

2026-10-20 bounded Agent/chat follow-up: full Vitest377/377 passes, final agent/workspace
73/73 and canonical history4/4 reruns pass. Production build, typecheck and lint pass.
Native chat/history, cumulative word selection and shell pass. Opt-in real Gemma4 26B
test passed the exact temporary-file lorem ipsum proposal/main acceptance with unchanged
disk. No plaintext key logged or persisted. Mocked inline approval workflow passes,
including two-hunk partial acceptance, Undo, stale replies and external-conflict invalidation.
Global format retains unrelated sandbox/issues.md; task files checked separately.
Run `npm run dev`. Live test requires explicit TEXTRA_LIVE_AI_TEST=1 and existing key;
normal native checks do not consume Google quota. Remaining phase gates unchanged.

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

2026-10-19 Phase 2 closeout: `npm run format:check`, `npm run typecheck`, and
`npm run lint` pass. The full production build passes when run outside the managed
sandbox, whose identity cannot remove its own prior `out/renderer/assets` output.
The test runner under the sandbox reports 22 environment failures: hard-link and
junction creation are denied, and MiKTeX cannot read its registry configuration.
The remaining unit test was fixed by rejecting protected `.textra`, `.git`, and
`node_modules` paths as project compile roots. The elevated Vitest and Playwright
processes begin but are terminated by this managed session before they report a
result. A local desktop run is required for the full native and real-TeX matrix.
