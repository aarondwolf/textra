# Execution roadmap

Each phase depends on the preceding gate. Do not describe a partial gate as complete.

| Milestone      | Scope                                                                   | Acceptance / verification                                                      | Status   |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| 0 Foundation   | Electron/Vite, typed IPC, secure shell, themes, palette, panels, memory | dev native window + HMR; format, typecheck, lint, unit, build, Electron smoke  | Complete |
| 1a Files       | Project selection, safe file service, Monaco, tabs, conflicts           | Traversal/symlink rejection, atomic save, dirty and external edit preservation | Planned  |
| 1b Compile     | Discovery, bounded cancellable compiler, diagnostics                    | Real minimal/multi-file TeX and failed/cancelled builds                        | Planned  |
| 1c Preview     | PDF.js, navigation, search, SyncTeX                                     | Real PDF rendering and source mapping                                          | Planned  |
| 1d Workflow    | Project CRUD, settings, onboarding, pipelines                           | Full phase 1 workflow and missing-tool fallbacks                               | Planned  |
| 2 Writing      | Snippets, math, LSP/lint, outline, optional AI                          | Offline insertions/undo, diagnostics and explicit AI consent                   | Planned  |
| 3 Research     | TikZ, fragments, tables, BibTeX, Git/history, Beamer                    | Real previews, round-trip tests, no unrelated Git changes                      | Planned  |
| 4 Distribution | Templates, importer, accessibility, migrations, installers              | Security review, Windows install/uninstall, release matrix                     | Planned  |

Common gate: `npm run format:check && npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`.
Use PowerShell commands individually if the shell does not support `&&`.
Record blockers and exact next actions in memory; continue independent tasks when external software is unavailable.
