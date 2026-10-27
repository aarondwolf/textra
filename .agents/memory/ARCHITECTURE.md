# Architecture memory

2026-10-26 Explorer refresh and package policy:

- Confirmed deletion edits the cached tree instead of publishing a root-only scan.
  Refresh gathers prior page budgets with four directory reads at a time, then
  commits once if the project/listing/files generation still matches. Scroll
  restoration runs before paint. Main retains authority for validation and Trash.
- Main owns the miktexAutoInstall preference and supplies it to BuildService for
  normal builds. Shared safety flags preserve shell/first-line restrictions while
  choosing installer policy. Recipe arguments cannot override the global policy.

2026-10-26 Incremental directory listings:

- ProjectInfo.directoryPages describes loaded directory pages; treeState partial
  is not an error or proof that an absent path is missing. listingId changes on
  refresh. Main validates listProjectDirectory project/path/offset and enumerates
  only that folder via opendir (500 entries per response), with no recursive walk.
- Renderer merges and orders cached pages, bounds automatic folder reads to four,
  rejects pages from stale project/refresh generations, and reveals ancestors of
  opened documents. Optional source discovery follows explicit TeX/bibliography
  references through existing checked reads rather than a project-wide tree scan.

2026-10-24 Electron architecture refactor:

- Bootstrap acquires the per-profile instance lock before importing application services.
  application.ts composes services; window.ts owns secure window policy; ipc.ts owns
  fixed capabilities; lifecycle.ts owns workspace admission, generations and shutdown.
- Workspace resources stop/drain before replacing the project token. Application-scoped
  preference work remains available during transitions. Renderer persistence owners
  flush before retiring the old project, and acknowledge native close after settling.
- DocumentSessionController owns buffer lifetimes/versions, Monaco attachments and
  coalesced per-document saves. Approved replacements reconcile undoably; stale
  formatting is rejected and history restores preserve intervening typing.
- HistoryStorage owns canonical containment and bounded disk IO. Versioned catalogs
  are validated before use; portable .textra/history is authoritative. Lists paginate.
  Restore durably backs up captured editor and differing disk text before CAS save.
  Main notes the restored revision as a local save before watcher notifications.
- Language jobs own all process streams, limits, deadlines and awaited cancellation.
  TexLab has bounded incremental frames/backpressure and reserved shutdown admission.
  Watcher generations prevent stale registrations and samples after teardown.
- Pending preference writes settle before import/export. App's central dispatcher
  exclusively owns Save/Compile keyboard shortcuts; the legacy duplicate is removed.

2026-10-23 startup refactor: project APIs expose initial `treeState: loading` listings; known
files read before `refreshProject` completes the tree. `prepareProject` runs initialization
after core readiness. Renderer startup/session lifecycle handles versioned legacy-compatible
metadata, active-first single-flight restore and background tab reads without replacing buffers.
Independent per-feature lazy/error boundaries keep optional panes from suspending the editor.
`restoreLastPdf` reads bounded main-owned metadata under userData/last-pdfs, validates paths,
fingerprint/hash and PDF header, and registers preview bytes without SyncTeX authorization.
`prepareAI` imports code for eligible selected defaults only; services no longer eagerly load
the AI core. `useAISettings` shares an offline cache with writes superseding stale reads.
Writing's analysis cache and four-read background index replace per-render project scans.

Current redesign (2026-10-21; verification in progress): provider configuration v4
owns enabled state, validated base URL, manual models and per-role exact ID filters.
SDKs load lazily for real requests. Ctrl+I uses a separate scoped inline-edit service
and editor view zone; automatic completion remains native Monaco ghost text.
Endpoint changes revoke automatic-sharing consent. No fallback routes.
See AI_SETTINGS_IMPLEMENTATION.md.

TexLab request-loop fix: SourceEditor sync depends on document content/readiness,
not diagnostic-driven adapter identity. Shared adapter sessions coalesce source
updates and duplicate queries across recreated adapters. Main ignores identical
text and stale versions, serializes document transitions and closes removed buffers
through closeTexlabDocument(FileRef). LSP supersession/edits/timeouts cancel server
work; queues cap at 8 active and 64 total with whole-request deadlines. Local FIM
generation stops at its line budget or echoed suffix instead of EOS, using smaller
CPU context. Automatic completion targets 1–10 lines/384 tokens with 30s local or
10s remote deadlines; prompted Ctrl+I allows 4,096 output tokens/32,000 characters/60s.
New bindings prefer installed Qwen2.5-Coder0.5B. Monaco word-based suggestions are
off; deterministic completion is gated to LaTeX commands/structured arguments.

AI settings v3 stores roleDefaults plus automatic completion consent. Models carry
optional chat/completion/transport capabilities; old sparse chat metadata remains
compatible. Dedicated completion request/cancel IPC validates canonical TeX scope,
identity and bounds in main, with request-kind scheduling and no tools/fallback.
SourceEditor delegates to ai-completion.ts; latex-completion.ts scans cursor context.
The role selection Zustand store is memory-only per workspace, clears unavailable
overrides, and never changes another role. Monaco inline contribution is prebundled.
Native FIM uses the configured Mistral endpoint or verified Ollama suffix templates;
ordinary chat models share one completion instruction. Source/suggestion cache is
memory-only (32 entries/30 seconds), separate from persisted conversations.

Codestral uses the standard Mistral key and /v1/fim/completions. The unused legacy
dedicated connection is removed in v4. Prompted edits require chat capability.

OpenRouter shares Chat Completions transport at openrouter.ai/api/v1. Catalogue
uses authenticated /models/user?output_modalities=text and strict architecture
text-output filtering; auto/free routers are excluded. Routing requires supported
parameters, disables provider fallback, and preserves reasoning blocks for tools.
The provider card explains downstream routing. GitHub Models has retired; a future
Copilot SDK adapter is explicitly deferred, not a pending scope choice.

AI providers include Mistral (api.mistral.ai/v1) and DeepSeek (api.deepseek.com).
Both reuse the OpenAI-compatible listing/chat/tool transport with provider-specific
token fields. DeepSeek raw reasoning metadata survives tool replay. One Chat system
prompt is sent unchanged through every adapter. ai-models.ts owns text-model policy:
capability/modality checks at discovery plus family filtering when loading cached
models and validating defaults/requests. Ollama /api/show runs four at a time under
the listing timeout; missing metadata endpoints fall back to ID filtering. Only the
chosen provider/key/model IDs are sent during discovery; no document content.

Chat and Agent share the chosen provider-qualified text model. AIService owns
the encrypted provider keys and serializes all provider
operations. BoundedAgentService has no filesystem dependency: only staged pathless
read_current_file/insert_text/replace_range/delete_range, 64 tools, 24 API calls,
90-second deadline (180 seconds for Local Ollama). Remaining budgets are supplied
in each system prompt; cap errors identify the exhausted resource. AgentWorkspaceService validates canonical project paths and
disk revisions before run/accept. Active buffer snapshots get opaque expiring
contexts. Renderer reviews disposable read-only Monaco diffs. Each review API call
validates named approve/reject hunks, consumes the old proposal, updates the expected
buffer/context and returns only undecided changes rebased onto approved text. Renderer
checks the old live buffer after await, applies approvals through a guarded undoable
editor event and echoes the new snapshot. Rejections skip text; the last decision
closes review. No agent saves. Auto-save pauses during review and the normal guarded
save resumes for approved text after review ends. Model menu and Chat/Agent toggle replace the
previous locked label; mode switches preserve the transcript and selected model.

The assistant exposes a Chat/Agent toggle and preserves the transcript and selected
model across mode changes. Chat is the default, sends only the conversation, and is
used for Problems' automatic Ask in AI draft. Agent requires an active .tex context;
manual Send authorizes its captured snapshot, which is included as untrusted input so
simple edits can stage without a separate initial read tool call. Main still validates
the opaque context and staged changes. Document synchronization cancels only requests
that captured that document, so unrelated Chat requests continue. The first-selection
notice was removed with the earlier assistant consolidation.

User transcript bubbles remain separate after failed turns; only the provider-bound
conversation coalesces adjacent same-role messages. Both user and assistant content
use the safe MarkdownPreview renderer, with no raw HTML interpretation.
Agent read line tables include Unicode endColumn; invalid insertions return precise
column bounds, avoiding repeated guessed positions without widening tool budgets.

Workspace transcript deletion uses a narrow project-token/chat-ID IPC operation. Main
asks for native confirmation; the history service validates the ID, serializes removal
with saves and atomically publishes the filtered workspace history. Deleting the active
transcript clears its in-memory conversation. Problems drafts switch Agent to Chat before
reading the persisted auto-send setting, then follow the existing consent check.

Single-key AI settings expose deleteAIKey() through preload. Main confirms with a
native dialog and returns null on cancellation, otherwise GeminiService atomically
clears the credential/auto-send flag. Replacement uses the same tested single-slot
save API; renderer shows the password form only after Replace key is selected.

Chat streams cumulative text via onAIResponseChunk and optional send requestId.
Main validates IDs, preload validates chunk shape/32k bound, renderer accepts only the
active ID. Final replies commit once; partial cancelled/failed replies never enter future
conversation context. Gemini key tests remain lightweight nonstreaming requests. Existing
safe React-node MarkdownPreview renders full-width responses without raw HTML interpretation.
Response copy icons use the existing typed clipboard API. The compact composer contains two
text rows and an inset model/mode/send row; resize is disabled.

GeminiService owns bounded SDK calls and safeStorage-encrypted repository-local AI
configuration; key material never returns through preload. Separate from portable
preferences/exports and selected projects. Chat has no project service or tools;
Workspace prepares explicitly selected Problems snippets and Chat reviews by default.
Auto-send is an explicit persisted Chat consent setting (Agent always manual). Main pins endpoint/model allowlists and
sanitizes provider failures. Release TODO: move .textra-local to app userData.

Root coordinator owns config, shared/api.ts, docs/memory and integration.
Bounded delegates may own main/preload, renderer, or tests exclusively.
Shared contract changes require coordinator agreement. Main owns OS; renderer
calls window.textra through preload. See docs/ARCHITECTURE.md for data flow.

ProjectService owns canonical root + opaque session token; all file operations
carry token and relative paths. SHA256 protects saves. Protected/generated paths
and symlinks/junctions are excluded. Renderer polls <=50 open files and retains
content/savedContent/revision. Counted busy operations make editor read-only;
delayed reload compares project/content/revision before replacing text.

BuildService uses fixed tool argv, no shell, no shell escape/package installer,
bounded time/logs and process-tree termination. PDF reads expose cached bytes only
for the exact last-success output. PDF.js worker is local. ConfigService owns
.textra/project.json with schema1 safe atomic writes. Transfer bundles include
only exact portable preference fields, never secrets.

ExternalEditorService watches renderer-open files with debounced native events and
750ms polling. Typed watch events carry changing/stable/deleted/renamed lifecycle
states. Once a workspace document receives one, it is write-locked until the user
saves a create-only conflicted sibling snapshot or closes its buffer. Main suppresses
its own successful atomic saves from watcher notifications.

Provider reasoning deltas travel as a bounded display-only IPC event and SDK UI message part.
The renderer shows optional reasoning collapsed by default, then omits it when preparing the
next provider transcript and saving chat history. Google thinking output is requested only for
Gemini 2.5/3 model IDs; absent reasoning is a normal response. Markdown chat rendering opts into
always-visible fenced-code copy controls for both roles.
