# Decisions

- 2026-10-18: Canonical project settings are .textra/settings.json with JSONC support
  and preserved legacy project.json migration. Recipe/tool keys use LaTeX Workshop
  syntax; main keeps a positive execution allowlist. Builder and JSON view share
  the same schema and stale-snapshot save protection. Stable configured PDF paths
  use a success version counter for reload, and default paths include RELATIVE_DOC
  to avoid same-name document collisions. Separate aux is limited to verified
  direct MiKTeX engines; custom output folders are never automatically deleted.

- 2026-10-18: User prefers thin, inset rounded source tabs; fill only active tabs.
  Keep inactive tabs transparent with close buttons revealed on hover/focus.

- 2026-10-18: Remove application header/status footer; keep Settings in a left
  activity rail. Preview owns Compile and Preview/Problems/Output tabs; compilation
  never changes tab selection. Persist sideways preview collapse in previewVisible;
  retain legacy outputVisible field only for preferences compatibility. PDF search
  is scoped Ctrl/Cmd+F; replacement routes to source with Ctrl/Cmd+H.

- 2026-10-18: Compile lives in the top bar and always targets the active .tex tab.
  Recipe dropdown replaces root/compiler controls. Remember each document's last
  used recipe in project.json; defaultRecipe is a portable app preference with
  legacy preferences migration. Existing explicit root/engine configs seed only
  that document's remembered recipe. Open folder moves into the explorer.

- 2026-10-18: Follow Electron/main/preload/renderer separation and electron-vite.
  Native Electron is required; a hosted website is not a substitute.
- 2026-10-18: Use explicit relative-path APIs and revision-checked writes to protect
  user files. TeX defaults to no shell escape. No cloud or AI dependencies.
- 2026-10-18: Lock exact installed dependency versions; validate declarations and
  official docs. Foundation gate must pass before later phase work.
- 2026-10-18: Bundle preload as CommonJS (`index.cjs`) for Electron's sandbox.
  Electron-vite 6 supports `build.externalizeDeps`; use no external preload deps.
- 2026-10-18: Override Monaco's pinned DOMPurify 3.4.15 with patched 3.4.17.
  Registry audit after installation reports zero vulnerabilities. Reassess on updates.
- 2026-10-18: Allow navigation only to the exact trusted main-frame app URL so
  preload reload works. Deny other URLs, redirects, subframes, and new windows.
- 2026-10-18: Phase 1 file operations will carry an opaque project session ID and
  SHA256 content revision. No force-save API. Reject symlinks and protected paths;
  poll only open files for external changes. User chooses roots via native dialogs.
- 2026-10-18: Builds use unique build/textra output directories and retain last-good
  PDF bytes in main, preserving preview after failed builds. No general command API.
- 2026-10-18: Settings are strict schema1, unknown versions preserved. Project
  overrides are opt-in; app exports exclude recents, paths, and credentials.
- 2026-10-18: Core native workflow passes but full Phase 1 remains incomplete;
  installer/manager actions and editable pipelines are the next gate work.
- 2026-10-18: Put Vite dependency cache in OS temp, keyed by checkout path, outside
  Dropbox/OneDrive. Explicit eager dependency list avoids incremental rediscovery.
  The synced node_modules cache repeatedly failed directory renames with EBUSY.
