# Current state

2026-10-22 Comprehensive UI polish, shortcut execution, and diagnostic intelligence:

- Tab Pill Width Stability: file tab pills no longer jitter or resize when modified/saved; `.dirty-dot` occupies constant layout dimensions with opacity transitions.
- Direct PDF Opening: clicking PDF files in the file explorer now directly opens them in the Preview pane without an extraneous confirmation dialog.
- Editor Word Selection & Typing Stability: resolved Monaco selection reset where typing followed by `Ctrl+Shift+Back` or `Ctrl+Shift+Left/Right` truncated multi-word selections. Prevented unintended active Monaco model value resets and guarded AI completion inline listeners.
- Settings Appearance & AI Typography: added a distinct border to Surface and Background color swatches under Appearance; harmonized AI Settings typography with system fonts and standard header styling.
- Markdown Preview & Toolbar Integration: clicking a PDF no longer locks the Preview pane against subsequent Markdown previews; editor formatting toolbar renders a dedicated Markdown preview document icon (`FileText`) when editing Markdown files.
- Files Tab Actions: "Reveal in Explorer" on folders uses `shell.openPath` to open inside the folder rather than selecting the folder in its parent directory; grouped Open Folder alongside Reveal in Explorer and Open in VS Code.
- Writing Tab Styling: removed pill containers around collapsible Outline and Notes sections; matched `% TODO` icon color to the accent TODO pill.
- Build Tab Compilation & Auxiliary Cleanup: synchronized header Compile button feedback ("Built", "Failed") with the preview compile button; added a "Clear Auxiliary Files" broom button (`Broom` / `cleanAuxiliaryFiles`) that safely cleans intermediate artifacts while preserving output PDFs.
- Snippets & Symbols: single click expands snippet details (Name, Description, Code); double click inserts; custom snippets feature a flat 24px edit icon button (`Pencil`) with inline editing controls.
- Assistant Tab Icon Refinement: removed circular borders from the privacy notice dismiss button and code block copy buttons.
- Keyboard Shortcuts System: built action selector for custom bindings (`saveAll`, `formatDocument`, `cleanArtifacts`, `cleanAux`, `openFolder`, `newFile`, etc.), implemented global shortcut matching (`matchesShortcut`), and wired keyboard dispatcher to execute actions across the application.
- Diagnostics AI Troubleshooting: appended external tool source notices to AI troubleshooting prompts (`"Note: This was flagged by [source], not the LaTeX compiler..."`) for issues originating from ChkTeX, TexLab, or reference checkers. Standardized Problems toolbar height to 29px.
- Verification: 489/489 unit tests pass, typecheck passes with 0 errors, ESLint passes with 0 errors, Prettier format check passes.


2026-10-22 UI/UX refinement & visual hierarchy polish:

- File tab save animation: tab titles remain steady while a subtle accent border flare animates on save alongside unsaved dot clearing. Removed distracting "Saved" text swap and heavy box-shadows.
- Editor word selection: fixed Monaco Ctrl+Shift+Left/Back selection behavior by immediately clearing navigation intent state on jump triggers, allowing uninterrupted multi-word selections.
- Navigation rail & layout: standardized sidebar collapse row to 40px centered without a bottom border; relocated the Search tab to the bottom rail section directly above Recent Projects.
- Appearance & Theme Colors: theme color pickers (Accent, Strong Accent, Accent Background, Background, Surface, Text) are now compact, borderless filled color swatches that automatically sync with built-in theme presets and custom theme definitions. Expanded Settings dialog to 940px width and nav to 195px to prevent line wrapping.
- Files Tab: redesigned top section into three distinct rows: (1) title, Open Folder button, and right-aligned Reveal in Explorer / Open in VS Code icon buttons, (2) file search input, (3) transparent root directory path with New File / New Folder actions. Removed dead "Refresh project" button and wiring.
- Writing Tab: removed pill containers around collapsible Outline and Notes sections; fixed section collapsing layout bug so neither section is clipped when both are collapsed; updated Notes icon to notepad & pen (`NotePencil`) and added `ListChecks` for `% TODO` items; removed circular borders on header action buttons; removed dead focus mode stub.
- Build Tab & Compilation: fixed Compile button and Problems button flex overlap in header; wrapped Recipe Editor with proper horizontal padding; populated "Default recipe for new documents" with all available presets and project-specific custom recipes.
- Snippets Tab: moved "+" action inside the Templates & Snippets card as a faded full-width "+ Add snippet" button at the bottom.
- Assistant Tab: simplified empty state prompt to a single concise line; configured composer textarea to auto-grow up to 180px with input lines; added dismissible provider notice that stays hidden until the active model is switched.
- Formatting & Editor toolbar: added direct output PDF button next to Hide in formatting toolbar, enabled when a compiled PDF exists; matched Problems toolbar height to the formatting toolbar for visual symmetry.
- Markdown Preview: removed the "Previewing <filename>.md" top bar for clean, unobstructed rendering.
- Verification: 556/556 vitest unit and integration tests pass, typecheck passes with 0 errors, ESLint passes with 0 errors and 0 warnings, Prettier format check passes.

2026-10-22 Settings integration & dialog consolidation:

- AI Settings: eliminated duplicate `AISettingsDialog` modal dialog and DOM portal container injection hack. Converted AI settings into an integrated inline panel (`AISettingsDialog` / `AISettingsPanel`) embedded directly in `SetupDialog` under the `ai` section. Header gear icon, unconfigured card action, and provider warning triggers in `ChatPanel` directly open `SetupDialog` at `section: 'ai'`.
- Recipe Management: embedded `CompileRecipeEditor` directly inside `SetupDialog`'s Compilation tab (`section: 'compilation'`). The "Manage recipes…" compile dropdown button and Command Palette item now route to Settings -> Compilation instead of opening an external standalone recipe dialog.
- Open Settings Routing: `textra:open-settings` custom events and Command Palette entries ("AI settings", "Manage compile recipes", "Configure keyboard shortcuts") now reliably navigate to specific sections (`ai`, `compilation`, `shortcuts`, `appearance`, etc.).
- Verification: 556 unit and integration tests pass, typecheck passes, lint passes with 0 errors/warnings, prettier format check passes.

2026-10-22 UI/UX audit, Build tab refactor, and Settings customization follow-up:

- Build tab: renamed from "Compile" to "Build"; header houses matching primary Compile
  and Problems button copies on one line; removed "Project health", "Generated files", and
  "Document formatting"; simplified the recipe editor with faded "+ Add", step edit icon opening a
  common modal ToolEditorDialog, and "Save" / "Save As" actions; card styled as an open section.
- Writing tab: fixed latexindent executable lookup and % TODO / % FIXME comment-boundary parsing;
  header features Document Format button beside Focus button (standardized 24px icon buttons);
  Outline panel is placed first followed by Notes with a vertical resizable splitter defaulting
  Notes to a compact collapsed height.
- Snippets tab: Math Symbols & Templates sections are collapsed by default with lock icons and
  settings toggles to persist open-by-default preferences; custom snippets are consolidated into
  the main card with inline add/delete controls and dedicated snippet prompts.
- Chat & Models: Model picker chevron flips up; Ctrl/Cmd+/ toggles the picker; active file pill
  positioned northwest above the composer and restricted to Agent mode; header buttons standardized
  to 24px icon-only with tooltips.
- Appearance & Custom Themes: support custom UI font and Monaco editor font; custom theme builder
  in SetupDialog saving to preferences with live CSS variable injection for background, surface,
  accent, and text colors.
- Editor & Diagnostics: removed document length constraint for editor minimap (remains off by
  default); added official ChkTeX documentation manual link for rule codes and severities; fixed
  Monaco find widget hover tooltip pointer obstruction; keyboard shortcuts viewer supports adding
  and editing custom key bindings; clicking a PDF in the file tree automatically opens and focuses
  the PDF preview pane; split compile button error styling covers both halves on failure; document
  saving replaces toast with a subtle accent pulse on the tab pill.
- Verification: 556/556 vitest unit and integration tests pass, typecheck passes, lint passes with
  0 errors and 0 warnings, prettier format check passes, electron-vite production build passes.

2026-10-22 Agent deletion follow-up: authorized Agent runs now have an exact-source
delete_range tool. Deletions remain staged for explicit review and cannot directly write files.
The shared prompt briefly guides literal LaTeX backslashes and balanced braces/environments.
Code-block copy controls are icon-only. Custom snippet creation offers a copyable editable
prompt and a prefilled Ask in Chat draft that bypasses automatic sending.

2026-10-22 assistant activity UI follow-up: reasoning-only streams no longer render an empty
Markdown preview. Chat/Agent thinking uses animated ellipsis dots; the active document editor
gets a subtle pulsing accent border only during an authorized Agent request. Reduced-motion
preferences disable both animations while retaining the editor cue.

2026-10-22 assistant display follow-up: typed SDK reasoning deltas now cross the validated
preload bridge and render in a faded, collapsed-by-default panel only when the provider returns
them. Gemini 2.5/3 receives includeThoughts; other Google-compatible models do not. Reasoning is
excluded from future provider turns and saved chat history. Fenced code has an always-visible,
working copy button in user and assistant bubbles. Fixed the composer flex hit targets so the
context chip/model label cannot cover the model or cancel controls. Focused unit checks pass
19/19, typecheck and build pass, lint passes with the existing draft dependency warning, and the
native chat e2e passes 1/1 (34.3s), including collapsed reasoning and both copy controls.

2026-10-22 chat follow-up: a fresh prompt after an unanswered/failed user turn now remains a
separate visible bubble; adjacent same-role turns coalesce only at provider serialization.
User messages now render through the safe MarkdownPreview component, including fenced code.
Typecheck and focused conversation/Markdown unit checks pass (5 tests). Native UI check not run.

2026-10-22 assistant UX follow-up: restored the Chat/Agent switch over the SDK assistant.
Chat is the default, sends no document/tools, and Problems' Ask in AI forces Chat. Agent
manual Send explicitly authorizes the active .tex snapshot; the agent receives it as
untrusted context and can stage a direct edit without a separate initial read call.
Document sync only cancels an in-flight request bound to that document. Per-hunk approval
can advance using the live renderer snapshot while main remains authoritative for context
validation. Follow-up diagnosis confirmed the reported Google failure was HTTP 503/high demand,
misreported as network failure because SDK errors were not normalized at the assistant runner.
Assistant errors now normalize status and safe response detail. Gemini 3.5 Flash-Lite uses
minimal thinking for Chat, low for Agent, and provider stream retries are disabled. Typecheck
passes; targeted assistant/runtime tests pass 48/48. Native Windows interaction remains
unverified. Agent response latency remains model/network dependent, and tool edits still
require model tool-call and final-response work.

2026-10-21 AI SDK migration (working tree, not committed). Chat and Agent are replaced by one
SDK-backed assistant: main builds models with the Vercel AI SDK 7 (ai-sdk-runtime.ts, guarded
fetch, maxRetries 0, lazy provider packages), assistant-runner.ts uses ToolLoopAgent with the
four pathless tools over the extracted staging buffer (agent-staging.ts), and the renderer uses
useChat with an Electron IPC transport (assistant-transport.ts). Ctrl+I streams a growing
preview; chat-based automatic completion uses streamText; Codestral FIM and Ollama generate stay
native. Settings v5 migrates Chat/Agent to Assistant. Custom SSE/chat/tool transcripts and
@google/genai are removed. Evidence (Linux container, 2026-10-21): typecheck, lint, build pass;
vitest 525 pass with 9 pre-existing real-TeX integration failures caused by the container's
TeX install; Electron e2e agent, chat, completion, provider-settings, shell, ui-consistency and
editor-word-selection pass under xvfb. project-workflow and recipes fail on Linux for
environment reasons (external watcher, real TeX). Windows native e2e has not been rerun.
Also fixed: projectFileUri produced file://// on POSIX roots, crashing Monaco on file open.
Next: run npm install (lockfile updated) and the serial Windows e2e suite, then commit.

2026-10-21 provider v4 and prompted Ctrl+I redesign is implemented. Full unit 557/557,
native matrix 7/7, typecheck, lint and production build pass. Live local Qwen3B prompted edit and FIM pass; paid-provider live checks are blocked
by isolated-profile key decryption. Exact evidence and remaining normal-profile checks are in [implementation tally](AI_SETTINGS_IMPLEMENTATION.md).
Preserve user sandbox/test.tex changes; no unrelated phase gates advance.
Launch: npm run dev (restart for main/preload changes).
Source milestone: Add prompted inline editing and provider management (see git log -1).

2026-10-21 automatic-completion revision: target 1–10 lines/384 tokens instead of
stopping after the first useful line. Local Ollama automatic requests get 30s;
remote automatic requests get 10s. Ctrl+I stays 20 lines/512 tokens and 30s local,
15s remote. New bindings prefer installed Qwen2.5-Coder0.5B. Monaco word suggestions
are off; deterministic LaTeX/TexLab completion only runs for commands/structured
arguments, leaving prose quiet. Provider checks pass 53/53 with multiline, CRLF,
line-budget and suffix-stop coverage. Saved automatic model is now local
qwen2.5-coder:0.5b, with enabled consent and other role bindings preserved through
validated IPC. A live synthetic supply/demand TikZ request returned four lines/836
characters in 13.669s. Full unit checks pass 494/494. Native completion and shell checks pass 2/2
(31.7s/53.8s), covering quiet prose, multiline Tab insertion and one-step Undo.
Typecheck, lint, changed-file formatting and production build pass.
No phase gates advance.
Launch npm run dev after rebuilding main/preload changes.

2026-10-21 Qwen/TexLab follow-up: fixed a diagnostics/sync feedback loop by making
unchanged TexLab source idempotent and decoupling source sync from adapter identity.
Queries deduplicate, supersede/cancel on edits, close/reopen safely, and have bounded
8-active/64-total queues. Queued time counts toward deadlines. Local Qwen generation
stops at a useful automatic line or echoed suffix rather than waiting for EOS and
explanations. Local-only context is reduced to 1,024/256 (auto) or 4,096/1,024
(Ctrl+I) prefix/suffix characters; local deadlines are 10/30s, remote stay 2.5/15s.
Expected completion cancellation/busy is quiet; true timeouts have their own code.
Live main-service Qwen3B Ctrl+I succeeds (16.354s); the user's existing consented
Qwen1.5B automatic binding succeeds (1.498s) with synthetic code context. No model
choices, credentials, or consent settings changed. Real bundled TexLab burst
regression and mocked adapter/protocol regressions pass. See TESTING for final checks.

2026-10-21 inline completion implemented: four independent saved AI roles, v3
atomic config migration preserving keys/catalogues and separate Chat/Agent/Ctrl+I session
choices. Automatic starts off, requires native consent tied to its exact model,
and stays inside non-document environments/math unless outside continuation is
enabled. Shared scanner handles unfinished/custom environments, comments, math,
minted/lstlisting languages and literal contents. Ctrl+I works in editable TeX prose,
continues after selections, and exposes an anchored model/regen/accept/dismiss bar.
Both modes show ghost text and accept through one guarded undoable insertion.
Main validates scope, capabilities, consent, bounds and request identity; native
Codestral/Mistral FIM, verified local Qwen generate and shared chat completion
routes never fall back. Foreground work preempts automatic only; cancellation is
request-specific, including cancellation before canonical validation completes.
Missing models clear role bindings; removed temporary choices never silently revive.
470/470 unit/integration tests pass serially. See TESTING.md for native/live evidence.
Live first probe: Qwen3B timed out at 15s, Codestral unconfigured, Google saved key
cannot decrypt in the test OS session. No keys changed or models downloaded.
Launch npm run dev. GitHub and all unrelated roadmap phase gates remain deferred/open.

2026-10-21 Codestral: dedicated nested setup card inside Mistral, backed by its
own encrypted codestral provider profile at codestral.mistral.ai/v1. Catalogue
parent metadata drives nesting; child form/default/refresh/remove/draft saves
work independently of the general Mistral connection. Listing accepts Codestral
IDs only, excludes explicit non-chat capabilities, and never falls back to the
general Mistral key/host. Chat/Agent transport and system instructions are shared.
Full Windows suite 421/421 passes with normal permissions; see TESTING.md for
native/static evidence. GitHub is explicitly deferred by owner; no pending choice.
Launch npm run dev. Next: native/provider validation as recorded, remaining
roadmap gates and optional future GitHub work only when requested.

2026-10-21 OpenRouter: encrypted setup card, authenticated /models/user text-only
catalogue respecting account preferences, shared Chat/Agent transport and prompts.
Requests set require_parameters=true/allow_fallbacks=false; automatic auto/free
router IDs are excluded. Agent reasoning_details/reasoning survive replay.
Full tests 416/416 pass with normal Windows permissions; typecheck/lint/build pass.
GitHub portion was deferred by the owner after the in-chat choice:
GitHub Models retired 2026-07-30 (official docs); do not implement its old PAT endpoint.
Recommended alternative: official Copilot SDK, sign-in or fine-grained PAT with
Copilot Requests; disable built-in tools/discovery and preserve TeXtra prompts,
bounded staging and approval. This needs its own runtime integration, not another
Chat Completions URL. No Copilot dependency or credentials added yet.
No GitHub work remains active. Future live-provider verification uses user-supplied
setup. Launch npm run dev.

2026-10-21 AI setup/catalogue refactor: Mistral and DeepSeek added to the shared
provider catalogue, encrypted settings and fixed-endpoint Chat/Agent routing.
They share Chat Completions transport with OpenAI; max_tokens stays distinct from
OpenAI's max_completion_tokens. DeepSeek reasoning_content is replayed for tools.
Chat uses one unchanged CHAT_SYSTEM_PROMPT, tested verbatim across all seven wires.
ai-models.ts centralizes text-model family/modality filtering and cache cleanup;
Mistral completion_chat and Ollama /api/show completion capabilities refine discovery.
Ollama checks four models at a time; 404/405 metadata endpoints use the ID fallback.
Old cached specialist models are hidden and cannot be chosen for default/request;
keys remain intact. Refresh models performs full capability discovery.
Setup cards/copy are shorter; unused protocol metadata removed; Cancel replacement
clears the abandoned key draft. Native Chat checks all seven cards and passes;
verification details in TESTING.md. Launch npm run dev. Phase gates unchanged.

2026-10-21 UI consistency and Agent reliability: action/menu buttons and native/model
dropdowns use pill radii; Appearance select uses border-box paint with content insets.
Native scrollbars share a 5px arrowless style; source and diff Monaco editors use
matching narrow scrollbars without shadows/arrows. Snippets & Symbols and Writing
scroll as whole views instead of clipped/nested cards. New native ui-consistency spec
covers real wheel scroll, custom-form reachability, and dark/light dropdown geometry.
Agent now permits 24 provider responses/64 tools (previously six/twelve), reports
remaining budget each turn, encourages batching, and identifies the exhausted cap.
Deadline remains 90s (180s Local Ollama); scope/review/stale guards and discard-on-cap
remain. Unit/integration suite: 391/391 pass with normal Windows permissions;
typecheck, lint, production build and changed-file formatting pass. Native checks
and screenshot review are recorded in TESTING.md. Launch: npm run dev.
Remaining roadmap gates unchanged: native/platform matrix and release work.

2026-10-21 Save footer: Settings and AI settings dialogs share SaveFooter
(features/save-status). It shows autosave state (ui.ts saveState for preferences;
trackAISave/useAISaveState for AI writes) with an animated check, and Save settings
waits for pending writes, submits typed API keys, plays a confirm animation and closes.
Typecheck/lint pass; headless Chromium screenshots reviewed. E2E not run.

2026-10-21 Multi-provider AI: GeminiService replaced by AIService (ai-service.ts) plus
fixed-endpoint adapters (ai-providers.ts) for Google, OpenAI, Anthropic, Ollama Cloud and
local Ollama. ai.json is now version 2 (v1 key migrates to Google). New AI settings dialog
(AISettingsDialog.tsx), searchable ModelPicker, useAISettings hook; AISettingsForm removed.
IPC: saveAIProvider/removeAIProvider/refreshAIModels/setAIProviderDefault/setAIDefaultModel/
getOllamaStatus/startOllama/openAIProviderLink; deleteAIKey/saveAIKey/openAIStudio/
openAIRateLimits removed. Agent turns are provider-neutral. Owner's saved key was deleted
at his request so he can re-enter it through the new dialog. Evidence: typecheck, eslint,
prettier pass; unit suite passes except the real-TeX integration tests on a machine without
TeX; new ai-service (22) and ai-providers (12) tests pass; renderer build plus headless
Chromium screenshots of the dialog, picker and chat reviewed. E2E specs (chat, agent, shell,
agent-live) were updated for the new flow but NOT run (no Electron binary in the Linux VM).
Not verified live against real provider APIs; OpenAI/Anthropic/Ollama tool calling is
implemented from their documented formats.

2026-10-20 Chat history deletion and Problems mode handoff: history menu now offers a
per-chat delete action with native confirmation. Main validates the workspace chat ID;
the workspace history service serializes deletion with saves and atomically rewrites the
transcript list. Removing the active transcript also clears it from the panel. Problems
drafts now force Chat mode (and its default model) before checking the saved auto-send
preference, so the Ask in Chat button works after Agent mode. Targeted lint and formatting
and typecheck pass. No tests were added or run in this slice.

2026-10-20 AI defaults/handoff complete: Chat and Agent both default to Gemini
3.5 Flash Lite and expose all seven configured Google models. Chat asks for concise
answers and labels actionable fixes; the latest completed suggestion shows an
Implement Suggested Fix pill. Clicking switches to Agent, preserves draft/history,
and explicitly sends the preceding conversation with a simple implementation request.
Agent's first-selection disclosure fades after five seconds and never repeats in
the same profile, including after restart. Active-.tex scope/review stay mandatory.
Live verification found repeated guessed insertion columns; line tables now expose
endColumn and recoverable errors give exact bounds, keeping existing budgets intact.
All 418 unit/integration tests pass; build/typecheck/targeted lint/format pass.
Native Chat and Agent verify menus/defaults, handoff context, disabled non-.tex input,
notice fading/profile restart and sequential review; shell smoke passes. Live Gemini
3.5 Flash Lite staged both lipsum edits and passed sequential approvals with unchanged
disk after the column-feedback fix. Earlier failed live attempts are superseded by
this passing rerun. Commit 9be0142 records the full working tree. Documentation cleanup
is now removing the obsolete master prompt and reducing duplicate roadmap/test history.
Launch npm run dev; remaining roadmap gates unchanged.

2026-10-20 Sequential Agent fix complete: multi-part editing now permits six model
calls/twelve text tools under the unchanged 60-second deadline. Instructions require
all requested parts, preserve original line targets after insertions, and use only
the final narration. Budget exhaustion discards staging instead of returning partial
edits. New narrow review IPC immediately approves/rejects named hunks, rebases only
undecided changes, and advances the expected buffer/context. Renderer applies each
approval undoably and removes it; the final decision returns to the normal editor.
Approve all applies the remainder, Reject all keeps previously approved text.
Auto-save pauses until review completes; stale async approvals discard remaining
work and preserve the current file. Validation: 82 focused backend tests pass;
full suite covered 386 tests (385 passed initially; one unrelated EBUSY preferences
fixture cleanup passed on the six-test rerun). Typecheck/lint/build/task-format pass.
Live Gemma 4 26B passed adding lipsum and replacing original line 28 in one proposal,
then approving both sequentially with unchanged disk. Native immediate approvals,
advancement, final dismissal, Undo, stale responses, chat and shell pass. Native
fixture now waits for firstWindow before replacing IPC to avoid a startup race.
Launch npm run dev. Prior unrelated renderer/sandbox changes remain preserved;
working tree remains intentionally uncommitted. Earlier roadmap gates unchanged.

2026-10-20 Bounded Agent/chat follow-up complete: checkpoint0ea59a2 committed prior
working changes first. Chat now preserves conversations/drafts across mode switches,
passes prior conversation to Agent, saves/restores workspace-specific local history,
sends on Ctrl+Enter, and uses immediate model menu options with smaller send control.
Chat adds Gemini3.8/3.6 Flash and3 Flash Preview; Lite defaults remain. Agent tools
support omitted read args, line/column insertions and exact-text replacement, with
safe bounded correction. Staged reads/valid edits finish inside3 calls/8tools.
Inline read-only diff replaces modal; per-hunk decisions or Approve all then Apply
approved changes exactly selected hunks, undoably, after context/disk/buffer checks.
Monaco wordOperations import fixes cumulative Ctrl+Shift+Arrow selection.
Evidence:377 full unit/integration tests pass, final agent/workspace73 and history4
reruns pass. Build/typecheck/lint/task-format pass. Native chat/history, word selection,
shell and final inline approval/reject/partial-apply/Undo/stale checks pass. Opt-in
live Gemma4 26B proposed and main accepted exact temporary-file lorem ipsum insertion;
disk stayed unchanged. Native screenshots reviewed. No plaintext key exposure.
Launch npm run dev. Remaining roadmap gates stay incomplete. This feature slice
remains uncommitted alongside concurrent unrelated renderer/sandbox changes, preserved
without staging or reverting them. Global format still flags sandbox/issues.md.

2026-10-20 Chat alignment polish: header uses shared --bar-height like editor/preview,
no wrapping, with compact 24px pill buttons. Rail uses a single chat-and-sparkles SVG
through the existing Phosphor IconBase/context. Send glyph shrank from 16px to 14px
and its circle from 28px to 26px. Typecheck/lint/format/build and native chat checks pass;
header height equality/pill radii asserted and final screenshot visually reviewed.
Launch npm run dev. Existing mixed changes remain preserved and uncommitted.

2026-10-20 Chat composer/response UX: assistant replies now use full-width Markdown
without provider headings or bubble borders. A small copy icon below copies raw Markdown
through the existing clipboard bridge, with success/error feedback. User messages retain
bubbles. The composer contains two text rows and an inset footer with an ellipsized,
disabled Gemini 3.5 Flash Lite selector plus circular send arrow; empty is transparent,
non-empty uses accent. During streaming the circle becomes Stop. Existing streaming,
cancellation, consent and single-key management remain. Typecheck, targeted lint/format,
production build and native chat test pass, including exact Markdown copy and circle states.
Native conversation screenshot visually reviewed. Launch npm run dev. Existing mixed
changes remain uncommitted.

2026-10-20 Single-key management: AI settings now show saved-key state with explicit
Replace key/Delete key actions. Replacement reveals a cleared password form, supports
cancel, and tests the candidate before atomically replacing the one encrypted key.
Delete uses a typed no-argument bridge with native confirmation (Cancel default),
clears encryptedKey and auto-send, and does not require OS decryption. Failed changes
preserve existing settings; active Gemini operations reject deletion. Forty-seven
focused service tests, typecheck, targeted lint/format, build, and native chat/shell checks
pass. Native coverage verifies replacement/deletion UI and real confirmation cancellation.
Existing mixed working-tree edits preserved. Launch npm run dev.

2026-10-20 Chat streaming/UI follow-up: Gemini uses generateContentStream for chat,
nonstreaming for key verification. Bounded cumulative chunks travel over typed,
request-ID-correlated IPC; stale chunks are ignored. Model bubbles render safe Markdown
and incomplete replies stay separate from request history. Ask and Cancel use the pill style;
intro/privacy hides once a question is sent. Chat follows output only near the bottom,
uses scoped subtle scrollbars, and has a single rail icon after the main views/search.
Typecheck/lint/targeted format/build pass; existing PdfViewer lint warning remains.
Full suite: 282/284 passed initially; two EPERM atomic-rename failures in Gemini and
project fixtures passed on retry (54/54 across the affected suites). Native chat and shell
pass, including streamed Markdown, Ask styling, placement, and stale-chunk protection.
Screenshot review caught the app-wide list reset; chat now restores bullet/number markers.
No live Google requests in automated checks. Launch npm run dev.

2026-10-20 Gemini credential follow-up: removed AIza prefix/shape validation.
Any non-empty trimmed key up to 8,192 characters reaches the Gemini verification
call before encrypted saving; failed verification preserves the saved key. Password
input now says Paste your API key. Forty focused Gemini service tests, typecheck,
targeted lint/format and production build pass. Native chat regression passes and
checks that New chat sends only the new question and retains unsent composer text.
Launch npm run dev (restart main if using an existing dev session).

2026-10-20 Gemini debugging slice: owner requested optional conversational AI now.
Only gemini-3.5-flash-lite via @google/genai 2.30.0, main-process requests, typed
preload APIs. AI Chat rail onboarding and Settings share key testing/settings UI.
Repository-local .textra-local/ai.json (ignored) uses safeStorage encryption;
unavailable/basic_text encryption refuses saves. TODO migrate to global app data
before public release. Problems prepares bounded +/-5-line editable drafts;
auto-send opt-in defaults off. No AI file/command tools. History stays in memory
and resets on project changes. Preserved all pre-existing working-tree changes.
Validation: 276 unit/integration tests pass with desktop permissions; typecheck,
lint (existing PdfViewer hook warning), build pass; native chat test passes.
Global format check flags pre-existing sandbox/issues.md; diff check flags existing
sandbox/test.tex whitespace. Native chat now passes including bounded editable Problems
drafts/default no-send and opt-in auto-send; screenshots visually inspected. Native shell
and recipes also pass serially. Project-workflow still expects the old inline conflict
banner at line108, while the existing working tree shows the new dialog (KNOWN_ISSUES).
Immediate cancellation and external AI-settings conflict regressions pass. Live Google key
and OS account migration are not tested. Launch npm run dev; configure AI Chat with an
AI Studio key. Earlier phase gates remain incomplete; leave existing mixed edits intact.

2026-10-20 External file overwrite handling (working tree): Main now combines canonical-path
native watching with 750ms revision polling, debounces atomic save sequences, and emits changing,
stable, deleted and renamed states after a configurable 2–5s quiet period. Any event locks the
open renderer buffer against normal save/autosave/Ctrl+S. The blocking dialog offers a collision-safe
`CONFLICTED_timestamp` sibling snapshot or closing TeXtra's buffer; a read-only Monaco comparison
is available once stable. Preferences add detection, quiet-period, polling-only and optional
post-snapshot diff controls. Focused tests pass; typecheck, lint, format check and build pass.
`npm run test:e2e` remains blocked in this managed desktop session: all three Playwright Electron
launches exit before a window binds (exit code 2147483651), so conflict-dialog interaction still
needs a normal desktop verification run.

2026-10-19 Phase 2 closeout (working tree): Phase 2's requested offline feature
set is implemented. The final gate is native verification, not further product
scope. Formatting, typecheck, lint, and the production build pass. The managed
runner cannot complete native UI automation, unrestricted Windows filesystem
tests, or MiKTeX registry access; run the matrix in `docs/TESTING.md` from a
normal desktop session. `validateProjectConfig` now rejects protected metadata
folders as compile roots, and `.vitest` is ignored by Prettier.

2026-10-19 Environment Enter fallback (working tree): terminal output showed
repeated failed `textra:texlab:request` calls. These are language-server
failures, not an Electron crash. To make paired environments independent of the
suggestion widget and TexLab, Enter after a complete `\\begin{name}` now inserts
an empty indented line and matching `\\end{name}`. It leaves a nearby existing
matching end alone. TexLab errors now carry their safe error code in main-process
logs and return a local-fallback message to the renderer. Typecheck, lint,
format check, and production build pass.

2026-10-19 Empty environment completion (working tree): accepting a local
`\\begin{…}` suggestion now uses a Monaco snippet to insert the closing brace,
an empty indented line with the cursor, and matching `\\end{…}`. It does not
add `\\item`, labels, captions, or any other environment-specific content.
Context-aware content templates are deferred to Phase 3 by owner decision.
Typecheck, lint, format check, and production build pass.

2026-10-19 Environment completion reliability (working tree): asynchronous
TexLab requests can be cancelled while Monaco replaces completion requests as a
user types, so environment suggestions were intermittent. `SourceEditor.tsx`
now serves standard `\\begin{…}` environments locally and synchronously, and
uses the closest unmatched `\\begin{…}` for `\\end{…}` completion. It ignores
unescaped LaTeX comments when building that environment stack. Typecheck, lint,
format check, and production build pass.

2026-10-19 Monaco completion widget fix (working tree): LaTeX automatic
suggestions were enabled but the modular Monaco build had omitted its Suggest
Controller contribution, so no suggestion widget could render. The contribution
is now imported in `SourceEditor.tsx` and Vite's optimized Monaco dependencies.
Typecheck, lint, and production build pass; the development app reached
`application-ready`. Native interaction testing of `\\begin{item` and
Ctrl+Space remains the next check.

2026-10-19 TexLab integration (working tree): TexLab 5.26.0 is bundled under
`resources/texlab/win32-x64/texlab.exe` for Windows x64. The pinned artifact hash, GPL-3.0
license text, attribution, and source URL live beside it. The default-enabled preference
controls an Electron-main JSON-RPC/LSP process, which owns document synchronization and returns
completion, diagnostics, hover, definition/references, symbols, folding, and inlay hints through
typed IPC. The renderer preserves local completion/folding fallbacks. Checks passed: the bundled
binary reports version 5.26.0; typecheck, lint, format check, build, and native app launch.
Remaining distribution work: provide matching macOS/Linux assets in installer packaging.

2026-10-19 Phase 2 language tooling slice (working tree): ChkTeX runs on explicit save
when available and returns source-linked diagnostics; latexindent formats through stdin and
shows a proposal before replacing the open buffer. The Problems panel merges build, ChkTeX,
and deterministic local reference diagnostics. Each problem has TeX Stack Exchange search,
copy troubleshooting prompt, and a disabled Ask in Chat placeholder. Prompt context uses the
smallest enclosing completed environment, otherwise 100 lines either side. Writing sidebar
shows counts, cursor-aware outline, TODO/FIXME, and a quiet focus control. The local parser
is comment/verbatim aware and scans up to 250 project .tex files for label/reference/image
checks. This description predates the bundled TexLab integration above.

2026-10-19 Problems follow-up (working tree): compiler diagnostics now reassemble immediate
unindented TeX line-wrap continuations, so searches and prompt copies receive messages such
as “Undefined control sequence.” instead of the clipped physical log line. Prompt copying
uses the main-process clipboard bridge because renderer clipboard permission is denied by
the secure Electron session. Save completes before best-effort linting begins.

2026-10-19 Phase 1 checkpoint: owner manually verified XeLaTeX and LuaLaTeX compilation.
SyncTeX remains untested in this UI round; macOS/Linux and crop/rotation fixture coverage
remain follow-up verification. The Phase 1 implementation is being committed as the
checkpoint before the offline language tooling and diagnostics Phase 2 slice.

2026-10-18 Snippets sidebar view (working tree): rail button with a "{ }" glyph
(sidebarView 'snippets'). features/snippets/snippets.ts holds 12 built-in snippets (table,
table with notes, figure, figure with subfigures, lists, equation, align, theorem and
proof, minipages, section, footnote). Double-click or Enter inserts through the same
textra:insert-source event as the equation palette; hovering shows needed packages. No
user-defined snippets yet. Owner confirmed equation double-click works. Not run natively.

2026-10-18 Equations moved to the left sidebar (rail button with sigma, sidebarView
'equations'); it has an Environments group (equation, align, matrices, cases, inline/display
math). Insert event is cancelable so the palette reports failure. Earlier note: Equations tab (working tree), originally a preview tab. features/equations/ holds a searchable palette of about 300 symbols in 14
groups (structures, Greek, operators, relations, arrows, big operators, sets, delimiters,
accents, functions, spacing). Double-click or Enter inserts at the cursor through a
textra:insert-source window event handled in SourceEditor (replaces the selection, cursor
lands at $0 or inside the first {}). Hover/focus shows the LaTeX and any needed package.
Glyphs are Unicode, no math renderer dependency. Not run natively.

2026-10-18 Compile progress (working tree): BuildState gained optional stepsDone/stepCount
(set in BuildService around the recipe step loop). The Compile/Cancel button fills via a
--progress CSS variable: (done + 0.5) / count, capped at 95%, animated with @property.
Step-based only; no page-count estimate. Drop-downs in Settings/Recipes/PDF controls are
themed (native open list still OS-drawn). Recipes and tools are edited separately, with a
draft-mode helper for early passes. Not run natively.

2026-10-18 Preview/Settings round (working tree): PDF page, zoom and locate controls now
render in the preview header (React portal into .pdf-slot) beside Compile and the Preview/
Problems/Output tabs; below 560px header width they collapse into a "..." menu. Output tab
has a Copy button in the header. Editor tab strip and preview header share --bar-height
(40px, border-box). Settings is a dialog with a section list (Appearance, LaTeX tools,
Compilation, Import & export); LaTeX tools rows show the path with a pencil (and an undo
icon for custom paths). Build recipes dialog opens on a recipe list (pencil per recipe),
Output location radios (build folder / PDF beside .tex with aux in build / custom), default
recipe, and settings.json link; the per-recipe editor has steps, toggle chips with
explanations for tool arguments, locked chips for managed arguments, and a %TAG% glossary.
Logic lives in src/shared/recipe-help.ts (unit tested). Not run natively. Someone else is
migrating lucide to Phosphor via src/renderer/src/icons.tsx; added Hammer, Palette, Wrench,
Undo2 there. VM typecheck reports missing Phosphor types (node_modules not installed here).

2026-10-18 PDF jitter fixes (working tree): page renders to an off-screen canvas and swaps
in one step (resizing the visible canvas cleared it); fit-width resize is debounced 120ms and
the scroll area reserves its scrollbar (scrollbar-gutter) to avoid width feedback loops;
scroll position scales with page height on re-fit; recompiling keeps the old document on
screen until the new one loads (no canvas unmount); search highlights are computed in a
separate effect so searching no longer re-renders the bitmap. Not verified natively.

2026-10-18 Folding icon fix (working tree): the box glyph came from the minimal Monaco
entry omitting codicon.css (icon font), which also affects find/suggest widget icons. The
font CSS is now imported by relative node_modules path (package exports cannot address
.css) and fold controls are drawn as small +/- masks in styles.css, shown on gutter hover
when open and always when folded. Not verified natively.

2026-10-18 Round 4 (working tree): explorer folders now start collapsed (expandedFolders
set; opening a file or reveal-active expands its ancestors). Folding was still dead after
the contribution imports because deep monaco imports were not in Vite optimizeDeps.include,
so they loaded as separate raw modules whose registrations the pre-bundled editor never
sees; all Monaco entry points are now listed. e2e asserts folding icons exist and nested
files are hidden at start. Not run natively: restart npm run dev fully to rebuild the cache.

2026-10-18 Explorer/editor round 3 (working tree): root cause of dead folding was the
minimal Monaco entry (editor.api.js) lacking the folding, bracketMatching and comment
contributions; they are now imported. Sidebar is resizable (persisted sidebarWidth
160-480, drag/arrow keys/double-click reset). All sidebar icon buttons have tooltips.
Context menu reads Open in File Explorer / Open in VS Code. New file/folder create
inline in the tree beside the selection (Enter creates, Esc/blur cancels, names only).
Owner decision: explorer shows literally everything (build/, .git, .textra, aux files);
validateRelativePath no longer blocks protected names, so rename/delete work on them
(delete uses the OS trash, with confirmation). .git and node_modules are listed but not
walked so the 10,000-entry limit cannot hide real files. Compile still refuses
.git/.textra/node_modules roots in latex.ts. Not run natively; if folding is still
absent, check Vite dev-server re-optimization of the new monaco deep imports.

2026-10-18 Explorer/editor fixes (working tree): file clicks no longer open the actions
menu; it opens on right click, Shift+F10/Menu key, or the "..." button on the selected
row. Project name header is an inert label; rows are flush left with 14px per folder
level. Folding now uses a LaTeX FoldingRangeProvider (environments, sectioning, comment
runs; features/editor/folding.ts) because Monaco's default indentation folding cannot
fold unindented LaTeX. Folding logic was run directly on fixtures in a Linux VM; UI
behavior still needs a native check.

2026-10-18 Phase 1 completion slice (working tree, uncommitted): explorer subfolders
collapse with chevrons and open/closed icons (root has no chevron); Copy Path and Copy
Relative Path in the context menu (handler moved to its own IPC registration);
reveal-active button; window-focus project refresh; Monaco folding and LaTeX theme;
font size and word wrap persisted in preferences; custom executable paths per TeX tool
(absolute path whose file name must match the tool, stale override reports not found);
PDF search highlights with previous/next match; shared inset selection styling.
Owner decisions: TeX install help moved to Phase 4; TEX root unsupported. Verified in a
Linux VM: typecheck, lint, format; preference validation logic run directly. Vitest,
build and native Electron checks could not run there (Windows native binaries) and
must be run on Windows: npm test, npm run build, npm run test:e2e.

2026-10-18 Project recipes checkpoint: canonical .textra/settings.json is generated
on explicit folder/recent open, safely migrates legacy project.json without deletion,
accepts JSONC, and preserves invalid/future files. Popup builder and JSON view edit
defaults/new named recipes, ordered tools, output/aux paths, SyncTeX and project
default. Same Workshop recipe/tool keys and documented placeholders; commands,
flags, env and paths remain allowlisted. Compile loads disk settings afresh, saves
per-document selection only when changed, and avoids unnecessary comment rewrites.
Expected snapshots prevent stale popup overwrite; bounded Windows lock retries keep
rechecking paths/conflicts. Explorer clicks are disabled during async project changes.
Configured outputs default to build/textra/%RELATIVE_DOC%; never auto-pruned. Direct
MiKTeX supports separate aux; latexmk/TeX Live require aux=out. Stable PDF outputs
carry pdfVersion so the viewer reloads bytes; failed sidecar mapping is disabled.
Verified 179 tests in 16 files, all three native workflows, typecheck, lint, format,
production build. Native includes builder/JSON/external edits, stale save conflict,
same-path PDF text refresh and existing no-data-loss workflows. docs/RECIPES.md and
recipe-builder.png document compatibility and limits. Full Phase 1 remains open for
installer/manager, custom executable paths, explorer folder collapse/reveal-active,
persisted font/wrap and wider platform/PDF validation. Earlier UI follow-ups are
included in this checkpoint; sandbox/.textra remains untracked manual project data.

2026-10-18 Empty-state follow-up (working tree): Recent Projects now uses a native
keyboard-accessible details/summary disclosure, collapsed by default and anchored
at the explorer bottom. Its expanded list scrolls independently. Replaced the large
welcome copy with a 22px heading, one sentence and one action; PDF empty state is
also smaller and concise. Typecheck/lint/format pass; production build and native
shell smoke pass after retrying a transient Windows output-directory lock. Native
empty-state screenshot visually reviewed.

2026-10-18 Tab styling follow-up (working tree): source file tabs are inset 28px
rounded rectangles with a filled active state and transparent inactive state. Removed
full-height tab dividers/active underline. Inactive close controls appear on hover or
keyboard focus; dirty indicators and focus outlines remain. Production build and
native project workflow pass; screenshot visually reviewed and updated.

2026-10-18 Activity rail follow-up (working tree): added Files icon for File Explorer
and Blocks icon for Extensions. Explorer opens the existing project tree; Extensions
opens a clearly labeled future-extension placeholder. Active view is highlighted;
collapse and Settings remain separate. Sidebar view switches preserve documents and
dismiss file menus. Typecheck, lint, formatting, build and native shell smoke pass.

2026-10-18 Compact controls follow-up (working tree): Compile/recipe, Preview,
Problems, Output and collapse now share one compact row. Removed explorer bottom
action bar. Left-clicking an entry opens an accessible action menu (files also open
in editor); right-click/Shift+F10 work too. Rename/Delete keep existing save and
confirmation protections; Reveal/VS Code retain narrow bridge actions. Native
workflow passes with menu/rename-cancel checks and measured toolbar alignment;
typecheck, lint, formatting and build pass. Screenshot updated.

2026-10-18 Workspace layout follow-up (working tree): removed app header/footer and
PDF footnote. Left activity rail provides sidebar collapse, commands and bottom
Settings; theme selection is inside Settings. Compile/recipe/cancel now live in
Preview pane with Preview/Problems/Output tabs. Builds do not switch views or reveal
logs. Preview collapses sideways, expands editor and preserves mounted PDF state;
previewVisible is persisted with legacy preference migration. PDF search is hidden
until scoped Ctrl/Cmd+F; Escape closes. Ctrl/Cmd+H routes to source replace, with
Monaco find contribution explicitly loaded. Verified 116 focused tests, typecheck,
lint/format/build, shell persistence and native project workflow including PDF
search/replace, collapse, tab selection, real compile and settings-failure handling.
README and docs/screenshot.png reflect current UI. Existing untracked sandbox
project settings remain preserved.

2026-10-18 Compile follow-up (working tree): renderer fills missing recipe defaults
from older loaded preferences. Compile no longer disables on tool discovery results;
it attempts the selected allowlisted compiler and exposes errors. Optional recipe
persistence failures warn without preventing compilation. Disabled states explain
missing active .tex/current file operation and use not-allowed rather than wait.
Verified 24 focused tests, typecheck/lint/format/build and the native project workflow
with legacy preferences and an injected recipe-save failure. Sandbox project settings
created during manual testing are preserved as untracked user data.

2026-10-18 UI refinement checkpoint: removed the build toolbar row. A top-bar
Compile split button builds only the active .tex tab; recipe choices persist per
document in .textra/project.json on compile. Settings provides the portable default
recipe; old preferences and explicit root/engine settings remain readable. Open
folder is an explorer icon. Verified 65 focused tests, native project workflow
(including active-tab target, recipe restoration and new-document default), lint,
typecheck and production build. User sandbox/test.tex is preserved.

2026-10-18: Foundation complete; core Phase 1 workflow implemented. Full Phase 1
is incomplete. Last passing implementation commit: ea4c1ef (core IDE).
Foundation commit: 345fb44. All implementation and verification are committed.

Working: selected local roots, bounded explorer, UTF8 Monaco tabs/undo, safe saves,
create/rename/trash, recent/pinned projects, file-manager/VSCode actions, revision
conflicts, unsaved close/switch checks, TeX discovery, fixed presets, real bounded
cancellable builds, diagnostics, PDF.js pages/zoom/search, two-way SyncTeX including
chapters, settings import/export, project overrides and setup test compile.
No AI/network source sharing. See KNOWN_ISSUES for remaining features/limitations.

Evidence: typecheck/lint/build pass; 138 tests in 12 files pass including real
MiKTeX/BibTeX/latexmk/SyncTeX and filesystem junctions. Expanded native workflow
passes editing/conflicts/five-page PDF/settings/setup/unsaved-discard/reopen.
Final shell/reload checks passed, along with format/typecheck/lint/build/diff checks.

Next three actions:

1. Finish Phase 1 editable allowlisted pipelines and distribution install/manager
   workflows with current metadata and explicit in-app user confirmation.
2. Persist font/wrap, add context menus/collapsible tree/reveal-active and TEX-root
   hints; validate additional engines and PDF crop/rotation/zoom navigation.
3. Complete full Phase 1 acceptance matrix before proceeding to Phase 2.

2026-10-19 Editor formatting toolbar: a compact, default-visible toolbar now sits
above LaTeX source tabs. It provides bold, italic, numbered and bulleted lists,
figure, table, and section-level commands. Text selections are wrapped for inline
commands; environment commands insert an empty structure with one list item where
appropriate and retain the selected text. Insertions are single Monaco undoable
edits and place the caret at the first useful editing position. The editor's
ellipsis menu persists a Formatting bar shown/hidden preference. Typecheck, lint,
targeted format check, and production build pass. The global format check reports
only the pre-existing untracked `.vitest/json/output.json`. User sandbox/test.tex
and sandbox/.textra remain user-owned changes.

Launch: `npm run dev`. Checks: format:check, typecheck, lint, test, build,
test:e2e, test:dev. Desktop permissions may be needed for sandbox-blocked output
cleanup/junction tests. No installers, signing or cross-OS behavior verified.

2026-10-18 Sidebar identity follow-up (working tree): Lucide replaced by Phosphor via
src/renderer/src/icons.tsx. Extensions placeholder removed. New Document sidebar view
(features/document/DocumentView.tsx) shows the active .tex file's outline with included
chapters spliced in, and a tree of used files with missing/circular markers; parsing
lives in src/shared/tex-structure.ts and document-model.ts (tests/unit/tex-structure.test.ts).
Sidebar headings are serif sentence case; selection is pill shaped. Not yet verified in
the native window; package-lock.json needs `npm install` on Windows after the dependency swap.

2026-10-18 Pill language and Document view layout (working tree): tabs, compile control,
preview tabs, toolbar/PDF controls, icon buttons and menu rows share --radius-pill; menus and
popovers use --radius-surface (styles.css :root). Document view sections are collapsible, the
Outline/Files used boundary is a keyboard-accessible splitter, and Files used defaults to a
150px pane at the bottom; layout persists in localStorage (textra.documentView). electron.vite
config now pre-bundles @phosphor-icons/react instead of lucide-react. Checked in headless
Chromium against the production renderer build with a stubbed window.textra (not Electron).

2026-10-18 Full-width preview (working tree): preview header has an Expand/Restore button
and the palette has Toggle full-width preview. State is session-only (useUI.previewExpanded,
not a saved preference). The editor pane is hidden, not unmounted, so Monaco state survives.
Opening a file or jumping to a source line (explorer, problems, PDF double-click) restores the
split. Not visually verified: the renderer build in the Linux shell currently fails with EMFILE
on material-icon-theme's SVG glob. Typecheck and lint pass.

2026-10-19 Expand panes (working tree): useUI.expandedPane ('editor' | 'preview' | null,
session-only) replaces previewExpanded. Editor tab actions and the preview header each have a
diagonal-arrows (Phosphor ArrowsOutSimple/ArrowsInSimple) expand/restore button; the palette has
Toggle full-width editor and Toggle full-width preview. Expanding the editor hides the preview
pane (Ctrl+Enter still compiles); closing the last tab restores the split. Verified in headless
Chromium against a production build (state transitions and screenshots). To build in the Linux
shell, use a local copy of src with node_modules/material-icon-theme copied locally, since the
mount hits EMFILE on that package's SVG glob.

- Collapsed preview pane now shows a quick-access rail: expand, green compile/cancel circle, severity-colored alert (opens Problems), log icon (opens Output). The "Expand editor" button is commented out in Workspace.tsx; its state, palette command and effects are kept for a later decision.
