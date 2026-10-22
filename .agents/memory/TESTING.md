# Test evidence

2026-10-22 assistant activity UI follow-up: typecheck passes, Markdown rendering tests pass 2/2,
and changed-file Prettier check passes. Native chat e2e passes 1/1 after retrying with desktop
process access; the sandboxed launch attempt was denied by Electron startup.

2026-10-22 assistant reasoning/code-copy follow-up: typecheck passes; focused assistant runner,
runtime, transport and Markdown tests pass 19/19; lint exits 0 with one existing
react-hooks/exhaustive-deps warning in ChatPanel.tsx:292; changed-file Prettier check passes.
Production build passes after an elevated retry because Windows sandbox cleanup intermittently
denies Vite's generated out/renderer/assets directory. Native chat e2e passes 1/1 in 34.3s,
covering provider-exposed reasoning as collapsed display, copy controls on user and assistant
code fences, the current Chat/Agent toggle and request cancellation. The e2e needed desktop
access; its first runs exposed and corrected stale expectations and composer hit-target overlap.

2026-10-21 provider v4 / prompted inline-edit redesign: full unit suite passes
557/557 (43 files, 98.40s). Typecheck and repository ESLint pass. Standard production
build passes (no cleanup workaround needed in final run). Serial native matrix
passes 7/7 (4.3m): Agent review, chat/provider onboarding, prompted Ctrl+I and ghost
completion, word selection, custom-provider settings, shell and UI consistency.
AI/build execution are explicitly mocked in completion acceptance; real native
Monaco, preload and project IO run. Custom settings additionally passes 31.4s after
final filter Reset controls, counts and catalogue-age copy. Live local Qwen3B prompted
edit passes 21.594s (16 characters/one line, matching identity). Live Mistral FIM and
Google prompted-edit attempts are blocked before routing by key decryption in the
isolated test profile; credentials preserved, no claim of invalid production keys.
Local Qwen3B native FIM also passes3.592s (five characters/one line, identity matches).
Changed-file formatting and whitespace checks pass; whole format:check only warns
for unchanged docs/ROADMAP.md and sandbox/issues.md.

2026-10-21 multiline automatic-completion revision: provider checks pass 53/53
(`npx vitest run tests/unit/ai-providers.test.ts`). Focused provider lint and
formatting pass. Mock streams verify automatic ten-line and manual twenty-line
limits, multiple useful lines, CRLF split across chunks, early reader cancellation
and suffix-echo stopping. Full suite passes 494/494 (40 files, 113.80s).
Real saved automatic binding changed through typed IPC to local Qwen2.5-Coder0.5B,
with consent retained and other roles preserved. Live synthetic TikZ supply/demand
completion returned four lines/836 characters in 13.669s with identity matched.
Command: node tests/manual/ai-completion-live.mjs --run --provider=ollama-local
--automatic --figure. Native editor/shell checks pass 2/2 (31.7s/53.8s),
including quiet prose and multiline insertion/one-step Undo. Typecheck, lint,
changed-file formatting and production build pass. Build used electron-vite
emptyOutDir:false to avoid the known Dropbox asset-cleanup lock. Earlier evidence
below uses the earlier budgets/models.

2026-10-21 Qwen/TexLab follow-up: 488/488 unit/integration tests pass serially
(40 files, 119.29s). Focused AI adapters/service/editor checks pass 69/69 before
the added leading-newline case, which also passes; TexLab checks pass 14/14 with
a real bundled Windows process. A pending real symbol query survives 15 unchanged
syncs and a 16-request hover/completion/symbol/folding burst; edits remain usable.
Live synthetic main-service verification: Qwen2.5-Coder3B Ctrl+I returns one line,
five characters in 16354ms, with matching request/version/offset. Existing consented
Qwen2.5-Coder1.5B automatic selection returns one line/five characters in 1498ms.
No model defaults, consent or credentials changed. Earlier 10s automatic probe
timed out before the first-useful-line stop was added; final automatic probe passes.
Native completion passes (47.5s), exercising real Monaco/FS with mocked AI IPC.
Native shell passes (1.1m) with the additional close-document bridge method. Its
first rerun passed UI assertions but exceeded the old 90s cleanup budget; the
Windows two-launch/profile-cleanup budget is now 120s. Typecheck passes.
Final lint and production build pass; changed-file formatting/diff checks pass.
Initial full-suite preference fixtures hit Dropbox EBUSY cleanup/EPERM rename;
moving those fixtures to OS temp makes all six preference checks and the full
suite pass. Product preference storage/atomic writes are unchanged. Build uses
the recorded emptyOutDir:false workaround for generated Dropbox asset locks.

2026-10-21 inline completion: full Windows unit/integration suite passes 470/470
(37 files, 94.76s) using npm test -- --maxWorkers=1. Parallel runs passed all
completion tests but intermittently hit existing real-TeX deadlines and a
same-second conflict-copy timestamp expectation; isolated affected checks pass.
Final focused coordinator/role/service tests pass 23/23. Typecheck and lint pass.
Production build passes; Dropbox intermittently locks out/renderer/assets during
cleanup, so final rebuild uses electron-vite build({build:{emptyOutDir:false}})
without changing committed configuration. Global Prettier flags only untouched
docs/ROADMAP.md and sandbox/issues.md; changed files and git diff checks pass.
Native completion passes (53.0s, then 37.5s): real Monaco/files and mocked AI IPC,
off-by-default and quiet ordinary prose, manual prose/selection continuation,
late-response cancellation, automatic equation/literal-language completion,
Tab/Escape and one-step undo. Reviewed both manual/literal ghost screenshots.
Native shell passes (49.0s); Agent workflow and restart pass (1.4m) after allowing
60s for Windows profile/window startup. Chat reselects explicitly after provider
removal; reconnecting cannot silently revive its old temporary model. Chat passes
in isolation (34.0s). One combined run hit an intermittent initial rail SVG check;
unchanged isolated rerun passes. Native suites ran serially, never concurrently.
Live helper uses real main/HTTP with synthetic fixture source only: local
qwen2.5-coder:3b discovered verified ollama-generate transport, but its real
requests time out at the enforced 15s limit (15035ms/15058ms), including an
isolated retry. A direct synthetic 16-token generate probe succeeds in 5726ms
(123ms model load), confirming the local route responds but not demonstrating
end-to-end completion within the feature's deadline. Dedicated Codestral is
unconfigured; Google catalogue refresh cannot decrypt the saved key in this OS
test session. These are not live passes. No key replacements, downloads or model
substitutions performed. Live cleanup initially hit a Chromium shader-cache lock;
helper now retries temporary cleanup. Launch npm run dev. No phase gates advanced.

2026-10-21 nested Codestral: full Windows suite 421/421 passes (33 files, 31.56s)
with normal permissions. New fixtures cover separate Mistral/Codestral credentials
and removal, Codestral-only dedicated catalogue, explicit non-chat exclusion,
fixed host/auth, Chat prompt parity and Agent tools. Typecheck/lint/build pass.
Initial sandbox focused run hit one temporary settings atomic-rename EPERM; normal
suite resolves it. Initial lint raced a concurrently deleted test fixture; serial
rerun passes. Native Chat passes (34.8s): Codestral is nested in Mistral, root grid
stays at eight cards, own key/default/connect/remove flow works with Mistral unset.
Native shell also passes (49.0s). Reviewed disconnected/connected Codestral native
PNGs. Provider IPC/HTTP are mocks,
no live Codestral key or quota used. Changed-file formatting/diff checks pass;
global formatting still flags only untouched docs/ROADMAP.md and sandbox/issues.md.
GitHub explicitly deferred by owner. Launch npm run dev; no phase gates advanced.

2026-10-21 OpenRouter: all 416 Windows unit/integration tests pass (33 files,
28.77s) with normal permissions. Initial focused sandbox run 128/129 passed,
with a temporary atomic-rename EPERM; full rerun resolves it. New coverage pins
authenticated account catalogue, strict output modalities and router exclusions,
401 failure without public catalogue fallback, exact shared system prompt,
provider routing flags, and ordered Agent reasoning replay. Typecheck/lint/build
pass; changed-file Prettier/diff checks pass. Global format check still flags only
untouched docs/ROADMAP.md and sandbox/issues.md. Native Chat passes (30.6s) with
eight cards/OpenRouter password/key/save controls; native shell passes (50.3s).
Provider HTTP is mocked; no live
OpenRouter key/quota used. GitHub SDK implementation awaits owner scope choice.
Launch npm run dev; no phase gates advanced.

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
