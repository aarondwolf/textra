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

`src/shared/api.ts` defines serializable request/result types and the bridge.
Services live in `src/main/services`; security checks are shared by all filesystem
operations. Main retains the user-selected project root. Relative file paths are
canonicalized under that root. File snapshots carry revisions for compare-before-save.

Dependencies: renderer -> shared/preload bridge -> main handlers -> services -> OS.
Services do not depend on renderer. Build processes use argument arrays and no
shell, bounded logs/timeouts, one active build, and no shell escape.

Settings: versioned JSON under Electron userData, project overrides under
`.textra/settings.json` with legacy project.json migration. Canonical project JSON
uses LaTeX Workshop recipe/tool keys; shared shape validation is followed by main's
strict command/argument/path checks. Popup writes use an expected settings snapshot
and atomic publication. Every compile reads current settings. A PDF version counter
refreshes stable output paths in the viewer. No credentials in portable settings. Optional
AI chat is not a prerequisite for editing. Main's AIService owns per-provider
safeStorage-encrypted keys, cached model lists, provider preferences, role defaults and
request-kind coordination; ai-providers.ts holds the validated-endpoint wire adapters (Gemini via
`@google/genai`, shared OpenAI/Mistral/DeepSeek Chat Completions, Anthropic Messages, Ollama `/api/chat` for
ollama.com and 127.0.0.1:11434). Preload exposes settings views without keys, provider
save/remove/refresh/default calls, local Ollama status/start, bounded text conversation,
cancellation, and fixed provider links.
Chat has no project service or tools. The renderer explicitly builds Problems snippets
from the chosen diagnostic and current buffer (or a normal validated file read), then
shows a draft by default. Chat and Settings open the same AI settings dialog. AIChatStore persists
bounded transcripts in userData by canonical workspace hash; opaque scope registration isolates
queued saves across project switches. Chat history survives mode switches, and Agent receives
validated prior conversation for handoff. Saved transcripts can be deleted through a
workspace-scoped main-process request after native confirmation. Drafts and pending proposals
are not persisted.
Chat streams from every provider (SSE or NDJSON). A narrow response event carries a request ID and
bounded cumulative text; the renderer accepts only its current request's updates. Successful
responses enter the conversation once. Interrupted partial text stays visible for review but
is excluded from subsequent requests. Markdown uses the existing React-node preview renderer
without HTML injection. The chat follows arriving text only while the reader is near the bottom.

Models are provider-qualified `{ provider, model }` refs. Main accepts only models present in
the provider's cached/manual catalogue, enabled state, role visibility and capabilities. Four saved role defaults and
independent workspace session choices replace the overall default. Config v3 migrates
v2 atomically; v4 adds provider endpoints, enabled state, manual models and role visibility
without touching retained encrypted keys, catalogues or conversation storage.
Model discovery filters text chat capabilities (Mistral completion_chat, Ollama
/api/show completion, output modalities when supplied), with provider-family
fallbacks for sparse catalogues. ai-models.ts also filters old cached catalogues
and retains unavailable role bindings without a network request or silent rerouting; provider deletion clears its bindings. Ollama metadata requests run in
batches of four under the existing listing deadline; 404/405 falls back to names.
CHAT_SYSTEM_PROMPT is shared verbatim by every Chat adapter. Compatible providers
use one Mistral connection for Codestral FIM and Mistral chat. The unused legacy
Codestral profile is removed in v4. One custom OpenAI-compatible connection supports
standard model discovery/chat and optional keys; Agent requires explicit tool support.
Connections save offline, refresh explicitly, and silence without decrypting/loading SDKs
or making requests. Main validates saved endpoints; endpoint changes revoke automatic consent.
Compatible providers share listing/chat/tool transport; token field differences
stay in main. OpenRouter
uses /models/user?output_modalities=text, checks architecture.output_modalities,
and excludes automatic multi-model router IDs. Requests use require_parameters=true
and allow_fallbacks=false; reasoning_details/reasoning survive tool replay. DeepSeek
reasoning metadata is retained for tool replay, outside displayed response text.
The concise Chat prompt labels actionable fixes; the renderer offers an explicit
Implement Suggested Fix action that switches modes and submits the existing conversation
with a short implementation instruction. It uses the normal Agent scope/review path.
The first-selection Agent notice fades out and stores only a local UI dismissal flag.
BoundedAgentService runs a provider-neutral transcript (user, assistant with tool calls and
raw provider content, tool results); each adapter converts it to its own tool-calling format
and replays raw content such as Gemini thought signatures unchanged.
It stages active `.tex` text tools in memory with a fixed call budget;
it has no filesystem or process dependency. AgentWorkspaceService binds its opaque context
to a validated ProjectService path and disk revision. Narrow document/run/accept/reject
IPC methods expose no tool dispatcher. Renderer syncs the active buffer snapshot, shows
a read-only inline Monaco diff, and immediately applies each approved hunk as an undoable
editor edit. Main validates hunk IDs, consumes the old proposal, advances the expected buffer
and context, and rebases only undecided changes into a fresh proposal. Renderer rechecks the
old live buffer before applying and echoes the new snapshot. Rejections remove only their
changes; Approve all applies the remainder together. Auto-save pauses until review finishes.
Context changes revoke in-flight work and proposals. AIService serializes settings writes,
coordinates foreground Chat/Agent/manual-completion requests and preempts only automatic
completion work. Cancellation for completion is request-specific; main enforces model
capabilities, exact automatic consent, context bounds and timeouts. A canonical project/file
reference is validated before completion routing. No completion tools are exposed.

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
