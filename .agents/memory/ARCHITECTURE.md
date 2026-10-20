# Architecture memory

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
text rows and an inset locked model/send row; the current model remains Gemini-only.

GeminiService owns bounded SDK calls and safeStorage-encrypted repository-local AI
configuration; key material never returns through preload. Separate from portable
preferences/exports and selected projects. Chat has no project service or tools;
Workspace prepares explicitly selected Problems snippets and Chat reviews by default.
Auto-send is an explicit persisted consent setting. Main pins endpoint/model and
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
