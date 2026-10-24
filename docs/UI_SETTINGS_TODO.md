# Settings and toolbar UI implementation checklist

- [x] Map the requested views and inspect their current component/state/storage contracts; preserve all existing worktree changes.
- [x] Determine and document what “Recover earlier history” reads, how it preserves originals, and what the user must choose.
- [x] Add a shared Radix tooltip component with TeXtra surface styling and a compact accessible help-icon pattern.
- [x] Align History and Recent Projects section controls/headings/counters on one row; correct the Recent Projects count label.
- [x] Harmonize Editor and Files settings with consistent key/control rows and right-aligned control columns.
- [x] Appearance: provide installed system fonts in a dropdown, with the system default pinned first.
- [x] Editor: use concise accessible toggle switches for binary choices and a same-height integer input for autosave debounce.
- [x] Files: use aligned rows/toggle switches, an integer input for quiet period, and collapsible retention/pruning options.
- [x] LaTeX tools: use the existing LaTeX mark/icon if available; preserve current tool behavior. (No LaTeX logo/mark exists in the app icon set.)
- [x] Compilation: align selectors/actions and add user-level recipes while preserving project-local recipe overrides and migration behavior.
- [x] AI Settings: rename “Models” and the autocomplete card/controls as requested; keep provider behavior intact.
- [x] Build recipe editor: trace and fix greyed/offset recipe and step controls; verify edit/reorder/add and default selection.
- [x] Assistant history: simplify the conversation rows and add editable titles with a same-line title/date layout.
- [x] Editor toolbar: put Show formatting bar beside Save; replace the overflow menu with Save, Save As, font size, and wrap controls.
- [x] Audit the explicitly clean/no-change views (Shortcuts, Import & export, Files/Writing/Build/Snippets/Keyboard Shortcuts/Preview) and record any reproducible defects. Compact toolbar overflow and save-state regressions were fixed; no other reproducible defects were found.
- [x] Add/update tests for tooltips, setting persistence, global/project recipes, history actions, recipe editing, and toolbar controls.
- [x] Run typecheck, lint, formatting, unit/integration, production build, and targeted/native end-to-end checks; inspect screenshots for affected views.
- [x] Update current-state/testing/known-issues memory and verify all original user changes remain preserved.
