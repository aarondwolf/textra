# Security model

Renderer uses context isolation, sandbox, disabled Node integration and a CSP.
Navigation and new windows are denied. Main validates IPC sender and arguments.
The bridge never exposes raw ipcRenderer or a generic exec operation.

All project paths must remain beneath the canonical selected root. Reject
traversal, absolute paths, invalid components, and escaping symlinks.
Files use revision checks and atomic replacement. Dirty buffers must survive
failed saves and project switches. Destructive operations require confirmation.

External-change detection does not grant the renderer filesystem access. Main validates every
watch, read and conflict-copy reference against the selected canonical project root. A detected
external change locks original-path writes in the renderer and conflict copies are create-only,
collision-safe siblings; no version is deleted or silently overwritten.

TeX is executable input. Compilers run only after user action, with shell escape
disabled, a timeout and cancellation. This is not an OS-level TeX sandbox: open
and compile trusted projects only. External installation is not automatic.

The optional AI assistant transmits only user-submitted conversations and Problems snippets to
the saved endpoint of the selected model's provider from the main process. All generation uses
the Vercel AI SDK in main with provider objects built directly from the saved connection: no
Vercel gateway, hosted backend, account or environment-derived key is involved. Provider
packages load on request or during offline preparation of enabled selected defaults.
Preparation imports code only: no clients, key decryption, network calls, model warming,
downloads or server startup. Silenced providers are excluded. Every SDK request goes through a
guarded fetch that pins the configured origin and path prefix, rejects URL credentials and
redirects, joins the shared cancellation signal, and runs with `maxRetries: 0`. Built-in
endpoints are prefilled; users can explicitly configure a replacement or one custom
OpenAI-compatible connection. Main rejects URL credentials, query strings, fragments
and redirects. HTTPS is required except loopback/private IP HTTP endpoints, which are
shown as unencrypted. Endpoint changes invalidate catalogues and automatic-sharing
consent. A model must be in the cached/manual catalogue, visible for its role and
supported by an enabled connection; no automatic fallback provider,
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
guarantee a provider stops work on a request it has received. Raw provider errors never reach logs; bounded completion diagnostics contain only provider/model, transport, timing, HTTP status, finish reason and response size/outcome.
The renderer gets a mapped message with at most 240 characters of provider detail, with the
key redacted. Provider key and usage pages open through a fixed-URL main handler.
Streaming updates use a fixed IPC event with validated request IDs, at most 32,000 answer or
provider-exposed reasoning characters, and bounded tool-status strings; no tool arguments,
tool results, document reads, reasoning metadata or provider payloads are emitted. Optional
reasoning text is display-only, collapsed by default, and is not persisted or sent back in later
provider transcripts. Preload validates event shape and the
transport ignores stale requests. Renderer requests are untrusted: main validates them with a
strict Zod schema and never accepts renderer-supplied system instructions, tools or tool results. Cancelled or
failed partial replies do not become completed conversation turns. Markdown is rendered as
React nodes without interpreting raw HTML; renderer navigation/window restrictions remain.

Document access uses the same model allowlist, main-process SDK and encrypted key.
The active `.tex` file is shown beside the composer as available context. Chat is the default
and sends only the conversation. Selecting Agent and pressing Send explicitly authorizes sending
the captured active-file snapshot (at most 64,000 UTF-16 characters) through an opaque context
ID. Main adds that validated snapshot as untrusted source context, allowing the model to stage a
direct edit without a separate initial read call. Automatically sent Problems prompts carry no
context and stay tool-free. Without an eligible document, or when a connection has tool calls
turned off, Agent mode cannot run and the request has no tools.
Main validates the canonical project path and disk revision before requesting or accepting
a proposal. The staging service has no filesystem/process dependencies: tools are exactly
`read_current_file`, `insert_text`, `replace_range`, and `delete_range`, executed one at a time in emitted
order with a cancellation and document-validity check before each. Arguments cannot include
paths; line/column insert positions or exact expected text must match (UTF-16 offsets remain
compatible), replacement text must be non-empty, and deletions must match exact non-empty source
text; deletions still stage as proposals and never write files directly. Recoverable position
mistakes and calls to nonexistent tools return bounded feedback to the model (still limited by
the response budget); paths and extra arguments on real tools fail closed. Prior conversation is bounded context; the latest explicit user request controls the
task. Review outcomes recorded by TeXtra are added as fixed application notes, so earlier
rejected proposals are not presented to the model as applied.
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
Provider usage pages open through a fixed main-process URL; provider errors and keys are never
shown verbatim. A follow-up such as "apply that fix" is an ordinary manual instruction; nothing
initiates requests or approves edits without a click.

Provider credentials use Electron `safeStorage` encryption in `userData/ai/ai.json`.
Encryption must be available for key providers; Linux's `basic_text` backend is rejected.
Local Ollama stores no key. Saving a connection is offline; Test / Refresh explicitly
contacts the configured provider. Settings IPC returns configured flags, model lists
and defaults, never keys or ciphertext. Portable settings exports exclude credentials.
Development startup can exclusively copy an existing regular repository-local
`.textra-local/ai.json` into a missing userData store; it never overwrites an existing
store or deletes the original. Isolated test profiles never run this migration.
Keys remain bound to the OS account's storage backend. Release verification of
migration and OS storage remains required.

File history is plaintext source stored in the selected project's `.textra/history`.
It travels with project copies and sync services. Main validates every persisted record
and every storage path, rejecting symlinks, junctions, hardlinks, traversal, unsupported
versions, and malformed indexes. Index reads are capped at 16 MiB/20,000 snapshots;
compressed snapshots and decompressed source are bounded. Listings are paginated
(default 100, maximum 200). Invalid catalogs are preserved. Restore must successfully
back up the captured editor buffer and differing disk content before revision-checked
replacement. Pruning publishes the surviving index before removing unreferenced files.
Legacy app-data UUID stores remain intact; explicit recovery requires selecting a store
and confirming its import in a native dialog because the original project identity is unknown.

One instance owns each user profile. Closing awaits the renderer's persistence
acknowledgement, native discard confirmation when needed, resource cancellation,
and persistence queues. A failed acknowledgement or flush keeps the window open.
A known renderer crash or load failure requires an explicit native confirmation
before closing without its acknowledgement; persistence queues are still drained.
Optional language jobs have bounded concurrency, byte limits, deadlines, stream-error
handling and process-tree cancellation. TexLab framing and outbound writes are bounded.
Logs contain safe event/error codes, never document requests or raw storage errors.

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

Automatic completion and prompted inline editing expose only narrow request/cancel
methods, with no commands or tools. Main validates canonical project/file scope,
model capability, role visibility and context limits. Automatic suggestions require
native confirmation for the selected model and destination. Context bounds are
8,000 prefix/2,000 suffix/2,000 metadata characters; local-only Ollama uses 1,024/256
prefix/suffix. Automatic output is at most ten lines/384 tokens, with a ten-second
remote or thirty-second local deadline. Empty/echo-only responses quietly yield no
suggestion; authentication/quota failures suspend requests until retry/configuration.

Prompted Ctrl+I sends only an explicitly submitted instruction (4,000 characters),
selection (16,000), and nearby active-buffer context (16,000/4,000/4,000). Output is
bounded to 4,096 tokens/32,000 characters and sixty seconds. It has no Chat history
or project traversal. Selection replacements are previewed before an explicit,
undoable acceptance guarded by buffer version, source range, project and conflict state.
Source and suggestions remain memory-only; no retries, fallback routes, downloads,
automatic server startup or model warming on launch occur. Silenced providers retain
encrypted credentials but cannot decrypt keys, initialize SDKs, ping or run requests.

Last-PDF restoration accepts only a registered canonical project token. Main reads
bounded, versioned metadata from app userData and revalidates source/output paths,
symlink/hardlink restrictions, size, PDF header, file fingerprint and content hash.
Stale, missing or invalid output is ignored. No document is compiled automatically,
and cached bytes never authorize restored SyncTeX operations. Isolated native test
profiles also use an isolated AI store; they cannot read the normal userData credentials.

TexLab document closure uses a narrow canonical project/file reference and only
releases in-memory language-server state. Repeated unchanged source is not sent
again. Superseded or expired queries send LSP cancellation; active requests and
pending queues are bounded. Expected completion cancellation/busy results do not
produce warning logs; genuine model deadlines retain a distinct timeout error.
