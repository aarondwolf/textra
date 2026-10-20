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
Gemini chat is not a prerequisite for editing. Main's GeminiService owns SDK requests and
safeStorage-encrypted repository-local AI settings; preload exposes only settings flags,
key-test/save, bounded text conversation, cancellation, and a fixed AI Studio link.
Chat has no project service or tools. The renderer explicitly builds Problems snippets
from the chosen diagnostic and current buffer (or a normal validated file read), then
shows a draft by default. Chat and Settings share one configuration form. Session-only
history survives sidebar switches and resets when the selected project changes.
Gemini chat uses the SDK's streaming API. A narrow response event carries a request ID and
bounded cumulative text; the renderer accepts only its current request's updates. Successful
responses enter the conversation once. Interrupted partial text stays visible for review but
is excluded from subsequent requests. Markdown uses the existing React-node preview renderer
without HTML injection. The chat follows arriving text only while the reader is near the bottom.

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
