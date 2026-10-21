# Security model

Renderer uses context isolation, sandbox, disabled Node integration and a CSP.
Navigation and new windows are denied. Main validates IPC sender and arguments.
The bridge never exposes raw ipcRenderer or a generic exec operation.

All project paths must remain beneath the canonical selected root. Reject
traversal, absolute paths, protected/generated paths, and escaping symlinks.
Files use revision checks and atomic replacement. Dirty buffers must survive
failed saves and project switches. Destructive operations require confirmation.

External-change detection does not grant the renderer filesystem access. Main validates every
watch, read and conflict-copy reference against the selected canonical project root. A detected
external change locks original-path writes in the renderer and conflict copies are create-only,
collision-safe siblings; no version is deleted or silently overwritten.

TeX is executable input. Compilers run only after user action, with shell escape
disabled, a timeout and cancellation. This is not an OS-level TeX sandbox: open
and compile trusted projects only. External installation is not automatic.

Optional AI chat transmits only user-submitted conversations and Problems snippets to the
fixed endpoint of the selected model's provider from the main process:
generativelanguage.googleapis.com, api.openai.com, api.anthropic.com, api.mistral.ai,
api.deepseek.com, openrouter.ai, ollama.com, or the
loopback Ollama server at 127.0.0.1:11434. Redirects are refused. Only text chat models returned by
that provider's own model listing are accepted; there is no automatic fallback provider,
source discovery, or execution. OpenRouter is an explicitly selected
gateway: it forwards requests to the selected model's hosting provider, honoring
the account's provider/privacy settings. Its authenticated catalogue tests keys;
TeXtra disables provider fallback and does not expose automatic model routers.
Starting local Ollama runs only a found `ollama` executable
with the fixed argument `serve` (no shell). Problems drafts include up to five lines either side of the selected
line (600 characters per source line); sending is manual unless the person enables the
explicit auto-send setting. Conversations are stored locally by canonical workspace hash
under userData/ai-chats, with atomic writes, size/schema validation and symlink rejection.
Only opaque registered project tokens select a history scope; no renderer-chosen storage paths.
Queued saves for a previously registered workspace retain their original scope after switching.
The latest 100 chats are retained per workspace, 80 turns/128,000 text characters per chat,
16MiB per history file. History is plaintext private conversation content, not portable settings;
each saved chat can be individually deleted from the history menu with native confirmation.
Keys, pending proposals, streaming partials and drafts are not serialized as history metadata.
Requests have a 90-second timeout (180 seconds for local Ollama), one attempt, no automatic 429 retry, at most 40 turns,
64,000 input characters and 4,096 output tokens. Cancellation stops local waiting; it cannot
guarantee a provider stops work on a request it has received. Provider errors never reach logs;
the renderer gets a mapped message with at most 240 characters of provider detail, with the
key redacted. Provider key and usage pages open through a fixed-URL main handler.
Streaming updates use a fixed IPC event with validated request IDs and at most 32,000 text
characters. Preload validates event shape and the chat ignores stale requests. Cancelled or
failed partial replies do not become completed conversation turns. Markdown is rendered as
React nodes without interpreting raw HTML; renderer navigation/window restrictions remain.

Optional Agent mode uses the same model allowlist, main-process SDK and encrypted key.
Only an explicit Agent submit or **Implement Suggested Fix** click shares the active
`.tex` snapshot (at most 64,000 UTF-16 characters) and prompt (12,000 characters).
Main validates the canonical project path and disk revision before requesting or accepting
a proposal. The staging service has no filesystem/process dependencies: tools are exactly
`read_current_file`, `insert_text`, and `replace_range`. Arguments cannot include paths;
line/column insert positions or exact expected text must match (UTF-16 offsets remain compatible),
and empty replacement/deletion-only edits are rejected. Omitted arguments are normalized only
for the zero-argument read. Recoverable position mistakes return bounded feedback to the model;
unknown tools, paths and extra arguments fail closed. Prior conversation is bounded context;
the latest explicit user request controls the task.
Reads return only the current in-memory staging buffer. Sixty-four total tools, 24 provider
calls, 32,000 cumulative response characters and a 90-second whole-request timeout
(180 seconds for Local Ollama) bound each run. Each call requests 4,096 output tokens;
OpenAI reserves at least 8,192 completion tokens to accommodate reasoning.
The system prompt reports remaining responses/tools and asks the model to batch independent
edits and reserve a final summary. There are no automatic retries or background continuations.
Changing context invalidates pending work, including switching away and back to the same file.
Proposals require explicit inline review in a read-only diff and single-use approval. Deterministic
bounded line hunks are shared with main; decisions contain only validated hunk IDs, never
renderer-selected arbitrary replacement text. Each approval updates the expected buffer and
opaque context and returns only remaining changes rebased onto that buffer. Rejection removes
its change without altering the buffer. Old proposal IDs cannot be reused. Requests must finish
naturally within the call budget; exhausting the budget discards staging instead of presenting
a silently truncated partial task. Applying each decision rechecks
the buffer after asynchronous main validation and uses Monaco's undoable edit API; the agent
never saves a file. Auto-save pauses while review is pending so it cannot invalidate the
remaining review with an intermediate revision; normal guarded auto-save resumes for approved
text when review finishes. Manual/external edits still invalidate the remaining proposal.
Agent Problems drafts always require manual submit. 429/budget notices use a fixed main-process
AI Studio rate-limit URL; provider errors and keys are never shown verbatim.
The one-time Agent reminder uses a profile-local UI flag only; dismissing it never enables
automatic sending. Suggested-fix detection only offers a button on a completed reply;
it cannot initiate requests or approve edits without a click.

MVP keys use Electron `safeStorage` encryption in git-ignored repository-local
`.textra-local/ai.json`, with atomic writes, version validation and symlink rejection.
Encryption must be available for key providers; Linux's `basic_text` backend is rejected.
Local Ollama stores no key. A key is saved only after the provider's model listing succeeds;
failed tests preserve the previous configuration. Settings IPC returns configured flags,
model lists and defaults, never keys or ciphertext. Version 1 single-key files migrate to the
Google provider. Removing a provider requires native confirmation and works without decrypting.
It removes only TeXtra's local copy; key revocation remains a separate action with the
provider. An active AI request blocks removal.
Portable settings exports exclude this file. Repository-local storage may be synced/backed up with the
checkout; encrypted keys remain bound to the OS account's storage backend.

TODO before public release: move AI settings into Electron userData and an OS-level,
app-scoped store (for example electron-store plus safeStorage), add migration UX
and review spending controls and release packaging. The current location is an MVP only.
Logs must redact secret-like values. Never include environment dumps or keys.

Project recipe JSON does not grant arbitrary process execution. Commands and flags
are allowlisted, all steps are checked before execution, output/auxiliary paths stay
inside the project, and environment overrides are limited to TeX search paths.
LaTeX Workshop script tools and shell-command overrides are unsupported. External
settings edits are read on compile; stale popup writes conflict instead of replacing
newer settings. Invalid or future settings are preserved. See RECIPES.md.

Review focus: IPC, symlinks, traversal, concurrent edits, process lifecycle, PDF
input bounds, safe URLs, and restore paths. Report vulnerabilities privately to
the owner; a public security contact remains an owner decision.

Implemented limits: 5MiB UTF8 text, 10,000 tree entries, 50 tabs, 2MB build log,
64MiB PDF, 16M-pixel render backing/image bounds, 120s compile, 5s SyncTeX.
MiKTeX auto-install/first-line format parsing and shell escape are disabled;
latexmk uses -norc. PDF XFA is disabled and its worker is bundled locally.
Portable Node cannot atomically bind every path check to subsequent OS operations;
revalidation narrows but does not eliminate hostile concurrent TOCTOU mutation.
