# Architecture memory

Codestral is a separate credential profile at codestral.mistral.ai/v1. It reuses
Chat Completions transport and shared prompts but accepts only Codestral model IDs.
AI_PROVIDERS.codestral.parent='mistral' renders its own ProviderCard nested inside
Mistral; no key sharing or parent-configured prerequisite. GitHub explicitly deferred.

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
read_current_file/insert_text/replace_range, 64 tools, 24 API calls,
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

Chat asks for concise replies and marks actionable fixes with **Suggested fix:**.
A completed latest marked reply exposes an explicit Implement Suggested Fix action:
switch to Agent and send the existing transcript plus a simple request.
Agent still requires an active .tex context and review. Its first-selection notice
fades after five seconds and stores only a seen flag in profile localStorage.
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
