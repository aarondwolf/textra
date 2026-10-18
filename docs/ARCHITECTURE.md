# Architecture

TeXtra uses Electron + electron-vite + React/TypeScript. Branding lives in the
shared contract. Main owns filesystem and subprocesses; preload exposes typed
operations; the renderer has no Node access. Zustand stores UI preferences.
Monaco models stay in the renderer. PDF.js consumes bytes returned by a narrow
main API, never arbitrary filesystem URLs.

`src/shared/api.ts` defines serializable request/result types and the bridge.
Services live in `src/main/services`; security checks are shared by all filesystem
operations. Main retains the user-selected project root. Relative file paths are
canonicalized under that root. File snapshots carry revisions for compare-before-save.

Dependencies: renderer -> shared/preload bridge -> main handlers -> services -> OS.
Services do not depend on renderer. Build processes use argument arrays and no
shell, bounded logs/timeouts, one active build, and no shell escape.

Planned settings: versioned JSON under Electron userData, project overrides under
`.textra/project.json`; no credentials in portable settings. AI and key storage
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
