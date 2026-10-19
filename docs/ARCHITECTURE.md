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
refreshes stable output paths in the viewer. No credentials in portable settings. AI and key storage
are future integrations and must not be prerequisites for editing.

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
URLs after user clicks. No source content is transmitted.
