# Execution roadmap

Each phase depends on the preceding gate. Do not describe a partial gate as complete.

| Milestone      | Scope                                                                   | Acceptance / verification                                                      | Status               |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------- |
| 0 Foundation   | Electron/Vite, typed IPC, secure shell, themes, palette, panels, memory | dev native window + HMR; format, typecheck, lint, unit, build, Electron smoke  | Complete             |
| 1a Files       | Project selection, safe file service, Monaco, tabs, conflicts           | Traversal/symlink rejection, atomic save, dirty and external edit preservation | Core passed          |
| 1b Compile     | Discovery, bounded cancellable compiler, diagnostics                    | Real minimal/multi-file TeX and failed/cancelled builds                        | Fixed presets passed |
| 1c Preview     | PDF.js, navigation, search, SyncTeX                                     | Real PDF rendering and source mapping                                          | Core passed          |
| 1d Workflow    | Project CRUD, settings, onboarding, pipelines                           | Full phase 1 workflow and missing-tool fallbacks                               | Partial              |
| 2 Writing      | Snippets, math, LSP/lint, outline, optional AI                          | Offline insertions/undo, diagnostics and explicit AI consent                   | Planned              |
| 3 Research     | TikZ, fragments, tables, BibTeX, Git/history, Beamer                    | Real previews, round-trip tests, no unrelated Git changes                      | Planned              |
| 4 Distribution | Templates, importer, accessibility, migrations, installers              | Security review, Windows install/uninstall, release matrix                     | Planned              |

Common gate: `npm run format:check && npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`.
Use PowerShell commands individually if the shell does not support `&&`.
Record blockers and exact next actions in memory; continue independent tasks when external software is unavailable.

Full Phase 1 remains open: installer/distribution-manager actions, custom executable
path preferences, collapsible explorer folders/reveal-active, persisted font/wrap,
and broader engine/platform/SyncTeX/PDF fixtures. Editable ordered recipes, canonical
project JSON, the recipe builder, context menus and preview collapse now work.
PDF-beside-source output is configurable through recipes. The user's active-document
Compile rule supersedes automatic TEX-root redirection. See RECIPES.md for supported
commands/placeholders and separate-auxiliary-directory limitations.
