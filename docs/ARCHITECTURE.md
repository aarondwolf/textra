# Architecture

TeXtra uses Electron + electron-vite + React/TypeScript. Branding lives in the
shared contract. Main owns filesystem and subprocesses; preload exposes typed
operations; the renderer has no Node access. Zustand stores UI preferences.
Monaco models stay in the renderer. PDF.js consumes bytes returned by a narrow
main API, never arbitrary filesystem URLs.

The workspace has a left activity rail and explorer, source editor, and collapsible
preview pane. Compile and Preview/Problems/Output tabs belong to the preview pane;
builds preserve the user's selected view. Hidden PDF tabs remain mounted to retain
navigation state. PDF find is opened on demand; replace acts on the source editor.

Main startup is split into `index.ts` (profile lock), `application.ts` (composition),
`window.ts` (secure window policy), `ipc.ts` (fixed privileged capabilities), and
`lifecycle.ts` (workspace admission, transitions and shutdown). The instance lock is
acquired before service imports. Workspace transitions reject new work, invalidate
resource generations, cancel/drain admitted operations, and then replace the root.
Window close uses one shared preparation and a request-specific renderer persistence
acknowledgement before draining resources. macOS window recreation reuses the same
bounded application services.

The renderer's DocumentSessionController owns buffer lifetime/version and Monaco
attachments. Store snapshots feed presentation; accepted replacements reconcile the
attached model as an undoable edit. Saves coalesce by project/path and recapture the
latest buffer and disk revision after each acknowledgement. Formatting captures a
version and rejects stale previews. History restore captures recovery text, preserves
later typing and updates the saved baseline without overwriting a newer buffer.
History/formatting controllers and close-preparation owners keep those operations
outside presentation components.

Project history has one canonical storage resolver, bounded validated version-1
indexes and paginated listings. Portable history lives in `.textra/history`; opaque
legacy app-data store IDs are recoverable only through explicit reviewed import.
EOF-bounded reads use current data rather than treating a stale stat size as EOF.
Language tools use an owned process helper; one lint and format slot per workspace
provide cancellation, output bounds, deadlines and awaited teardown. TexLab uses an
incremental frame parser and an outbound queue that honors stream backpressure.

`src/shared/api.ts` defines serializable request/result types and the bridge.
Services live in `src/main/services`; security checks are shared by all filesystem
operations. Main retains the user-selected project root. Relative file paths are
canonicalized under that root. File snapshots carry revisions for compare-before-save.

Dependencies: renderer -> shared/preload bridge -> main handlers -> services -> OS.
Services do not depend on renderer. Build processes use argument arrays and no
shell, bounded logs/timeouts, one active build, and no shell escape.

Startup separates shell, editor, tree, recipe configuration, tool discovery and
optional-feature readiness. Project opening returns a canonical root token and an
initial listing marked `treeState: loading`; `refreshProject` completes enumeration
after the editor paints. Known files can be read before that scan. Session restore
opens the saved active file first and reads remaining tabs without changing focus;
explicit user actions cancel restoration. Session metadata is versioned, accepts
the previous shape, and is not rewritten while restoration is incomplete.

Each renderer feature has its own loading/error boundary. Monaco and PDF.js are
separate chunks; settings sections, provider editing, chat, writing, snippets and
diff views load when used. File-type icon catalogues and optional AI editor
extensions follow the first editor frame. Shared button, pane-header, compile,
problems, field and dialog components retain existing classes and layout.
Core editor host styles load with the shell. Monaco's ghost-text contribution
registers before editor construction; AI adapters and request handlers remain deferred.
Windows/Linux caption buttons render with shared icons and Radix tooltips. A narrow,
validated IPC exposes minimize, toggle-maximize, and close; close goes through the
existing shutdown coordinator. Main publishes maximize-state changes to preload.
Renderer-only modal state dims the caption controls while keeping their actions
available above dialog backdrops. macOS retains native window buttons. Custom caption
buttons do not provide Windows' native maximize-hover Snap Layout flyout.
Project analysis reads at most four files per yielded batch, prioritizes the active
file and its dependencies, and caches parses by content with a 300ms edit debounce.

`restoreLastPdf` reads bounded metadata in userData/last-pdfs, validates canonical
source/output paths, output fingerprint and SHA256, and registers only those PDF
bytes. Restored output is labelled Last compiled and cannot use SyncTeX before a
current successful build. `prepareProject` defers project-settings initialization
until core readiness; existing config reads and compile validation remain immediate.

Settings: versioned JSON under Electron userData, project overrides under
`.textra/settings.json` with legacy project.json migration. Canonical project JSON
uses LaTeX Workshop recipe/tool keys; shared shape validation is followed by main's
strict command/argument/path checks. Popup writes use an expected settings snapshot
and atomic publication. Every compile reads current settings. A PDF version counter
refreshes stable output paths in the viewer. No credentials in portable settings. Optional
AI is not a prerequisite for editing. Main's AIService owns per-provider
safeStorage-encrypted keys, cached model lists, provider preferences, role defaults and
request-kind coordination. Generation runs through the Vercel AI SDK (`ai` 7) in main:
ai-sdk-runtime.ts is the model factory. AI core and provider packages import on demand.
After core readiness, offline preparation can import enabled selected-default adapters
without constructing clients, decrypting credentials or contacting providers.
Adapters include `@ai-sdk/openai` using Chat Completions, `@ai-sdk/google`, `@ai-sdk/anthropic`,
`@ai-sdk/mistral`, `@ai-sdk/deepseek`, `@openrouter/ai-sdk-provider`, and
`@ai-sdk/openai-compatible` for local Ollama, Ollama Cloud and custom endpoints. A real request
builds its model directly from the configured connection (no gateway, hosted backend or environment
keys) and injects a guarded fetch. The guarded fetch pins every request to the configured origin and
path prefix, refuses redirects, joins the shared foreground cancellation signal, and every call
sets `maxRetries: 0`. SDK errors are mapped to TeXtra's error vocabulary without request bodies,
URLs or keys. ai-providers.ts keeps only what the SDK does not own: model discovery and the two
native fill-in-the-middle adapters (Mistral Codestral FIM and verified local Ollama generate).

One SDK-backed assistant exposes Chat and Agent modes. Chat is the default, sends only the
conversation, and has no document tools. Agent is selected explicitly and includes the captured
active `.tex` snapshot in the request context; its first tool call can stage an edit immediately
without a separate full-file read. The renderer uses
`useChat` from `@ai-sdk/react` with a custom Electron IPC transport (assistant-transport.ts);
provider calls and credentials stay in main. A typed `runAIAssistant` request carries a request
ID, a configured model ref, bounded text turns and, only for a manual Send with an eligible
active `.tex` file, an opaque document context ID. Main validates it with Zod and never accepts
renderer-supplied system instructions, tools or tool results. `onAIAssistantEvent` streams
display-only events (cumulative answer text, optional provider reasoning text and bounded tool
status) that preload validates; raw tool results, document reads, reasoning metadata and provider
payloads never reach display streams or persisted history. Reasoning appears collapsed by default
and remains ephemeral; it is excluded from provider transcripts and saved chat history.
`cancelAIAssistant` is request-specific, and a cancellation that arrives
before its request starts is remembered so the request never runs. The transport registers its
listener before invoking and removes it on completion, cancellation, workspace change and
unmount; stale events are ignored and interrupted replies stay visible as incomplete but are
excluded from later model context.

assistant-runner.ts runs a request. Without an authorized document (or when a connection has tool
calls turned off) it streams plain text with `streamText`. With one it uses `ToolLoopAgent`, which
owns tool-call parsing, transcript conversion, provider metadata replay (for example Gemini thought
signatures, Anthropic thinking signatures, DeepSeek reasoning_content and OpenRouter
reasoning_details) and multi-step orchestration. Only the pathless tools exist:
`read_current_file`, `insert_text`, `replace_range` and `delete_range`; any other tool name is fatal. Agent mode
shares the active document only on explicit Send, while Chat and automatically sent Problems
prompts remain tool-free. Gemini 2.5/3 models can return their provider-exposed thought text;
Gemini 3.5 Flash-Lite uses minimal thinking in Chat and low in Agent. Other Google-compatible
models receive no thought configuration and may return no reasoning. SDK HTTP errors are normalized at the runner boundary,
so provider outages retain their status and safe response detail. Tool calls
execute one at a time in emitted order (`toolCallConcurrency: 1`), and every operation rechecks
cancellation and document validity first. Budgets are unchanged: 24 responses, 64 tool calls,
32,000 characters of output, the whole-request deadline, and a document limit of 64,000
characters. A proposal is published only after successful completion; errors, truncation,
cancellation or budget exhaustion discard staging. agent-staging.ts holds the in-memory staging
buffer and validated edit operations (exact-field arguments, recoverable correction messages,
exact-source deletions staged for explicit user review); SDK tool handlers call it and never write
files or touch Monaco.
BoundedAgentService (agent.ts) owns the captured document context, proposals and review, and
AgentWorkspaceService binds its opaque context to a validated ProjectService path and disk
revision. Renderer syncs the active buffer snapshot, shows a read-only inline Monaco diff, and
immediately applies each approved hunk as an undoable editor edit. Main validates hunk IDs,
consumes the old proposal, advances the expected buffer and context, and rebases only undecided
changes into a fresh proposal. Rejections remove only their changes; Approve all applies the
remainder together. Auto-save pauses until review finishes. Context changes revoke in-flight work
and proposals. When review of a reply's proposal finishes, the workspace records an
application-owned outcome (applied, partial or rejected) on that reply; main turns it into a fixed
bracketed note in later model context so rejected changes are never treated as applied.

Problems snippets are built by the renderer from the chosen diagnostic and current buffer. An
automatically sent Problems prompt carries no document context and is therefore tool-free; a
later manual instruction can use the document tools. The former Implement Suggested Fix action is
replaced by an ordinary follow-up instruction. AIChatStore persists bounded text transcripts (plus
the review outcome) in userData by canonical workspace hash; SDK tool transcripts, drafts and
pending proposals are not persisted. Stored turns convert to SDK UI messages on load. Markdown uses
the existing React-node preview renderer without HTML injection, and the chat follows arriving
text only while the reader is near the bottom.

Models are provider-qualified `{ provider, model }` refs. Main accepts only models present in the
provider's cached/manual catalogue, enabled state, role visibility and capabilities. Three saved
roles (Assistant, Ctrl+I and automatic completion) plus independent workspace session choices
replace the overall default. Settings v5 migrates v2 to v4 atomically and offline: the Assistant
role takes the saved Chat model, otherwise the saved Agent model; unavailable selections are
preserved and shown as unavailable rather than substituted. Chat and Agent shared each provider's
chat visibility rule, so the unified role keeps exactly that rule. Credentials, endpoints,
catalogues and automatic-completion consent are untouched. Model discovery filters text chat
capabilities (Mistral completion_chat, Ollama /api/show completion, output modalities when
supplied), with provider-family fallbacks for sparse catalogues. ai-models.ts also filters old
cached catalogues and retains unavailable role bindings without a network request or silent
rerouting; provider deletion clears its bindings. One Mistral connection serves Codestral FIM and
Mistral chat; the legacy Codestral profile is removed during migration. One custom
OpenAI-compatible connection supports standard model discovery and optional keys; when its tool
capability is off, the assistant still answers in text and the composer says so. Connections
save offline, refresh explicitly, and silence without decrypting or loading provider packages.
OpenRouter uses /models/user?output_modalities=text, excludes automatic router IDs, and every
request sends `provider.require_parameters=true` and `provider.allow_fallbacks=false`.

Ctrl+I uses `streamText` through the same model factory, deadline (60 seconds), cancellation and
error mapping, with its own focused prompt and bounded selection/prefix/suffix context and no
history or tools. Main streams cumulative preview text over `onAIInlineEditChunk`; the renderer
shows a growing replacement diff or insertion preview, and Accept (button or Tab) is enabled only
after the final normalized result arrives. Chat-based automatic completion also uses
`streamText`; Codestral FIM and verified Ollama generate keep their native adapters. AIService
coordinates foreground Assistant/Ctrl+I requests and preempts only automatic completion work.
Cancellation for completion is request-specific; main enforces model capabilities, exact
automatic consent, context bounds and timeouts. A canonical project/file reference is validated
before completion routing. No completion tools are exposed.

SourceEditor installs a dedicated completion coordinator and Monaco inline provider.
The shared cursor-aware LaTeX scanner preserves literal blocks and tracks unfinished
environments, comments and math. Context is built only from the active buffer. The
coordinator owns debounce, rate limiting, stale snapshot rejection, temporary ghost text,
foreground suppression and a 32-entry/30-second memory-only cache. Tab acceptance checks
buffer version, cursor, scope, conflict and review state immediately before one undoable
insertion. Main normalizes fences, exact context echoes, suffix overlap, line endings
and response bounds. Native Mistral/Codestral FIM and verified local Ollama generate
receive contiguous prefix/suffix; chat transports share COMPLETION_SYSTEM_PROMPT.

Automatic completion targets 1–10 lines with 384 tokens. The editor displays only
ghost text; health/retry lives in settings. Prompted Ctrl+I is a separate view-zone
controller and main-owned inline-edit service: explicit instructions, bounded selected
replacement or insertion, preview and guarded one-step undo. It uses the selected
chat transport with a shared edit instruction, 4,096 tokens/32,000 characters and 60s. Chat adapters receive the line budget as shared context.
Native local generation stops at its requested line budget or an exact
distinctive suffix line instead of waiting for the model's explanation/EOS.
Shared completionTimeout keeps renderer and main deadlines consistent: remote
10 seconds for automatic remote and 30 seconds for automatic local-only Ollama. The renderer shrinks local context
to avoid unnecessary CPU prefill. Expected supersession is separate from timeout.
New automatic bindings prefer installed Qwen2.5-Coder 0.5B without pulling models.
Monaco word-based suggestions are disabled; deterministic LaTeX/TexLab completion
is gated to commands and structured arguments rather than ordinary prose.
TexLab synchronization is idempotent across adapter/diagnostic updates. It keeps
monotonic document versions, closes removed buffers, deduplicates equivalent queries
and cancels superseded/expired work. Eight active requests and 64 total queued
requests bound load; queued time counts toward the request deadline.

Development uses `electron-vite dev --watch`: React HMR, main restart and preload
reload. See the [official watch documentation](https://electron-vite.org/guide/hmr-and-hot-reloading)
and [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security/).
The sandboxed preload is bundled CommonJS. Runtime dependencies and development
tools are pinned in package-lock.json; the DOMPurify override patches Monaco's
transitive sanitizer dependency.

Services now include projects (root tokens, tree, revisions, mutations, recents),
latex (discovery, fixed presets, process lifecycle, PDF cache, SyncTeX), diagnostics,
settings (project overrides/portable bundle), preferences, external-editor, logger.
Renderer's workspace store protects dirty buffers and delayed reads. Main owns
native dialogs and validates all privileged requests. Setup links use fixed official
URLs after user clicks. Source content is transmitted only through explicit optional chat
submission, Ctrl+I, or explicit user-enabled Problems/automatic-completion settings.

The external-editor service watches only renderer-open canonical project files. Native directory
watch events are debounced and revision polling remains a 750 ms fallback. It reports changing,
stable, renamed and deleted states through the typed preload bridge; it never writes an original
file. Conflict snapshots use exclusive sibling creation and canonical-parent validation. The
workspace turns every non-watching event into a one-way write lock until the person explicitly
preserves a snapshot or closes the buffer.
