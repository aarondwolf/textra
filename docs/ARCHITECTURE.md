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
safeStorage-encrypted keys, cached model lists, provider and overall default models, and the
single in-flight request; ai-providers.ts holds the fixed-endpoint wire adapters (Gemini via
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
the provider's cached listing. Both modes share the selected model.
Model discovery filters text chat capabilities (Mistral completion_chat, Ollama
/api/show completion, output modalities when supplied), with provider-family
fallbacks for sparse catalogues. ai-models.ts also filters old cached catalogues
and repairs defaults without a network request. Ollama metadata requests run in
batches of four under the existing listing deadline; 404/405 falls back to names.
CHAT_SYSTEM_PROMPT is shared verbatim by every Chat adapter. Compatible providers
share listing/chat/tool transport; token field differences stay in main. DeepSeek
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
allows one chat or agent request at a time, and owns cancellation and sanitized provider errors.

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
submission or the user-enabled Problems auto-send setting.

The external-editor service watches only renderer-open canonical project files. Native directory
watch events are debounced and revision polling remains a 750 ms fallback. It reports changing,
stable, renamed and deleted states through the typed preload bridge; it never writes an original
file. Conflict snapshots use exclusive sibling creation and canonical-parent validation. The
workspace turns every non-watching event into a one-way write lock until the person explicitly
preserves a snapshot or closes the buffer.
