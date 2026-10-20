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

Optional Gemini chat transmits only user-submitted conversations and Problems snippets
to Google's fixed Gemini API endpoint through main-process `@google/genai`. Only
`gemini-3.5-flash-lite` is used; there is no fallback provider, agent loop, tools, source
discovery, or execution. Problems drafts include up to five lines either side of the selected
line (600 characters per source line); sending is manual unless the person enables the
explicit auto-send setting. Conversations are memory-only and reset on project changes.
Requests have a 30-second timeout, one attempt, no automatic 429 retry, at most 40 turns,
64,000 input characters and 4,096 output tokens. Cancellation stops local waiting; it cannot
guarantee Google stops work on a request it has received. Provider errors never reach logs
or the renderer verbatim. AI Studio opens through a fixed-URL main handler.
Streaming updates use a fixed IPC event with validated request IDs and at most 32,000 text
characters. Preload validates event shape and the chat ignores stale requests. Cancelled or
failed partial replies do not become completed conversation turns. Markdown is rendered as
React nodes without interpreting raw HTML; renderer navigation/window restrictions remain.

MVP keys use Electron `safeStorage` encryption in git-ignored repository-local
`.textra-local/ai.json`, with atomic writes, version validation and symlink rejection.
Encryption must be available; Linux's `basic_text` backend is rejected. Test calls must
succeed before replacement; failed tests preserve the previous configuration. Settings
IPC returns only configured/auto-send flags, never the key/ciphertext. AI settings
hold no key collection: replacement atomically overwrites the single credential after testing.
Deletion requires native confirmation, clears the encrypted credential and auto-send flag,
and works without decrypting it. It removes only TeXtra's local copy; Google key revocation
remains a separate action in AI Studio. Concurrent active Gemini operations block deletion.
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
