# Execution roadmap

Each phase depends on the preceding gate. Do not describe a partial gate as complete.

| Milestone      | Scope                                                                                                                                               | Acceptance / verification                                                      | Status               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------- |
| 0 Foundation   | Electron/Vite, typed IPC, secure shell, themes, palette, panels, memory                                                                             | dev native window + HMR; format, typecheck, lint, unit, build, Electron smoke  | Complete             |
| 1a Files       | Project selection, safe file service, Monaco, tabs, conflicts                                                                                       | Traversal/symlink rejection, atomic save, dirty and external edit preservation | Core passed          |
| 1b Compile     | Discovery, bounded cancellable compiler, diagnostics                                                                                                | Real minimal/multi-file TeX and failed/cancelled builds                        | Fixed presets passed |
| 1c Preview     | PDF.js, navigation, search, SyncTeX                                                                                                                 | Real PDF rendering and source mapping                                          | Core passed          |
| 1d Workflow    | Project CRUD, settings, onboarding, pipelines                                                                                                       | Full phase 1 workflow and missing-tool fallbacks                               | Implemented; verify  |
| 2 Writing      | Snippets, math, LSP/lint, outline, optional AI                                                                                                      | Offline insertions/undo, diagnostics and explicit AI consent                   | Implemented; verify  |
| 3 Research     | TikZ, fragments, tables, BibTeX, Git/history, Beamer, environment content templates, PDF presentation controls, reduced-motion-aware UI transitions | Real previews, round-trip tests, no unrelated Git changes                      | Planned              |
| 4 Distribution | Templates, importer, accessibility, migrations, installers, TeX install help                                                                        | Security review, Windows install/uninstall, release matrix                     | Planned              |

Common gate: `npm run format:check && npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`.
Use PowerShell commands individually if the shell does not support `&&`.
Record blockers and exact next actions in memory; continue independent tasks when external software is unavailable.

Phase 1 status (2026-10-19): the planned Phase 1 scope is implemented. TeX installation
help (winget/brew/package-manager flows and opening the distribution manager) moved to
Phase 4 by owner decision. `% !TEX root` redirection is dropped; Compile always builds
the active tab. The owner has manually verified XeLaTeX and LuaLaTeX compilation.
Remaining follow-up verification is macOS/Linux and crop/rotation SyncTeX fixtures.
Editable ordered
recipes, canonical project JSON, the recipe builder, context menus, collapsible folders,
reveal-active, persisted font/wrap, custom executable paths and PDF match highlights
now exist. PDF-beside-source output is configurable through recipes. The user's active-document
Compile rule supersedes automatic TEX-root redirection. See RECIPES.md for supported
commands/placeholders and separate-auxiliary-directory limitations.

Deferred UI ideas (pinned by owner, 2026-10-18): replace the left activity rail with a
labelled segmented control at the top of the sidebar (for example Files | Document |
Cites) so the sidebar stops resembling an editor activity bar. Not started. Further views
(bibliography entries, review/history) would slot into the same switcher. Also pending:
highlight the outline heading that contains the editor cursor.

Phase 2 status (2026-10-19): the requested offline implementation is complete: writing analysis,
cross-reference suggestions and diagnostics, ChkTeX and latexindent seams, unified Problems
actions, TexLab, the formatting toolbar, and Compile rail recipe controls. The owner deferred
AI work, custom snippet libraries, and equation-helper work to Phase 3. TexLab 5.26.0 is bundled
for Windows x64 and enabled by default. Its main-process LSP bridge provides completion,
diagnostics, hover, definition/references, document symbols, folding and inlay hints, while
TeXtra retains deterministic local fallbacks when TexLab is disabled or unavailable. The Phase 2
gate remains pending native interaction verification and the test matrix described in TESTING.md.
Other platform bundles and installer packaging remain Phase 4 work.
