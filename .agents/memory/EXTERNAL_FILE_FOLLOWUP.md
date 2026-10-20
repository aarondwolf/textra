# External-file conflict follow-up

## Purpose

Running handoff for the user’s manual validation of external-file conflict safety.
This file records completed checks, observed failures, implemented corrections, and
the next reproducible action. It contains no document content or credentials.

## Status at start — 2026-10-20

- Implementation baseline: native-watch plus polling external-change detection,
  guarded original-path writes, conflict snapshots, dialog, and read-only diff.
- Automated evidence before manual follow-up: typecheck, lint, format check,
  production build, and focused external-editor/preferences/workspace tests passed.
- Native Playwright Electron launch is blocked in this managed environment; manual
  desktop validation is the source of truth for interaction behavior.

## Intake

Manual validation passed the primary external-change behavior: detection, active
write state, write lock, conflict copies and collisions, quiet-period diff, close
without write, preference controls, polling-only behavior, and the original-path
safety rule. Core editing, compilation, SyncTeX, writing tools, TexLab fallback,
ChkTeX, and latexindent were also manually checked.

### Actionable feedback from the checklist

1. Remove the redundant external-diff Refresh action.
2. Rename/delete conflict recovery can trap the blocking dialog because the old
   reference cannot be resolved. Provide a dismissible recovery path that preserves
   the in-memory buffer safely; never overwrite an unexpected file.
3. Reset comparison intent/state after a resolved conflict; a later conflict must
   not automatically enter the diff because of an earlier choice.
4. Style: conflict precedence button needs spacing; conflict-diff rail icon must
   differ from Recent Projects; theme selector is clipped on the left; dropdowns
   need shared visual treatment; TexLab completion should be branded.
5. Editor: typing `%` and comment text causes repeated TexLab INVALID_ARGUMENT
   IPC warnings; only `.tex` files should receive language-server features; long
   files need a minimap; toolbar needs an internal hide affordance; investigate
   inconsistent backward Ctrl+Shift+Arrow selection.
6. Workflow/UI: simplify compile sidebar, remove Document rail tab and place files
   used in Writing, move Format Document to Writing, add file Duplicate, remove
   duplicate confirm steps, reorder rail, give PDFs a preview-open confirmation,
   improve Problems badge layout, and add shortcuts settings.
7. Add Markdown preview behavior, plain-language help for top common TeX errors,
   default enabled with a preference, and support documentation/tooltips for TODO
   and FIXME tags.

### Explicit non-failure notes

- Polling-only appeared visually identical to normal mode; that is expected when
  both mechanisms detect promptly, but the preference must remain visible.
- SyncTeX inverse navigation and source-to-PDF locate work; requested navigation
  arrows are a usability addition.

## Findings and changes

- Settings/Writing slice complete: Settings now has Keyboard shortcuts reference;
  TODO/FIXME syntax help; default-on common-problem-help toggle; automatic long-file
  minimap preference default; Writing Format Document affordance; and a select clipping
  correction. Workspace wiring and compile-sidebar layout remain to integrate.
- Problems slice complete in this continuation: conservative regex recognition for
  ten frequent TeX failures with plain-language explanation and TeX FAQ destination;
  category badges now share one responsive filter row. Preference wiring remains to
  integrate in Workspace.
- TexLab root cause identified: main validated a cursor position for document-symbol
  and folding requests that have no position. The position check has been narrowed to
  position-based methods; editor work also gates enhanced language behavior to `.tex`.
- Editor slice complete: enhanced editor/LSP behavior is now `.tex`-only; comment
  completion/hover/definition/reference calls are suppressed; minimap appears for
  200+ line documents when the enabled preference permits it; and the formatting
  toolbar has its own hide control. No TeXtra key handler owns Ctrl+Shift+Arrow,
  so the reported inconsistent backward selection remains a Monaco/host behavior
  requiring a fresh native reproduction rather than an unsafe override.
- In progress: external recovery and remaining Workspace-owned workflow changes.
- Conflict recovery/UI complete: removed redundant comparison refresh; recovery
  snapshots can dismiss rename/delete states without trapping the dialog; stale
  compare intent clears after resolution; padding and distinct diff icon added.
  Document rail was removed; regular rail order is now Files, Writing, Compile,
  Equations, Snippets, Search.
- Additional coordinator changes: duplicate-file action; one confirmation for
  delete (native Trash confirmation) and rename (named renderer action); scrollable
  sidebar and collapsed non-Build compile sections; direct, hostname-validated
  TeX FAQ opening for common-problem help.
- Markdown Preview is now a safe, dependency-free renderer for project Markdown
  files when Preview is selected. It deliberately supports a small readable subset
  (headings, paragraphs, lists, code, emphasis, and safe links) and does not inject
  document HTML into the application.
- PDFs chosen from Files now ask for confirmation and then open read-only in Preview;
  a subsequent compilation restores Preview to the newly built PDF.

## Verification — 2026-10-20

- `npm run typecheck`: passed.
- Focused safety and UI tests: 40 passed across external editor, workspace state,
  preferences, common-problem help, and Markdown Preview tests.
- `npm run lint`: passed.
- Scoped Prettier check of every changed implementation file: passed. The repository-
  wide formatter currently reports the user-created untracked `sandbox/issues.md`;
  it was intentionally not modified.
- `npm run build`: passed after a transient Windows `EPERM` lock on the generated
  `out/renderer/assets` directory cleared on retry.

## Remaining manual checks / optional follow-up

1. Re-open the desktop app and verify the revised conflict recovery from a rename
   and deletion: **Save recovery copy** should dismiss the modal and preserve text.
2. Confirm Markdown Preview and a non-build PDF selected from Files look correct.
3. The shared dropdown / branded Monaco-completion styling and the Saved-tab animation
   were not changed in this slice; assess them visually before investing in another
   styling pass.
4. Keyboard Shortcuts is currently a reference page, not arbitrary key remapping;
   remapping editor defaults needs a separate accessibility/Monaco design decision.
5. Ctrl+Shift+Left has no TeXtra interception. Reproduce in a native window with a
   precise text/caret example before changing Monaco keyboard behavior.

## Correction after implementation audit — 2026-10-20

The prior status overstated completion. Manual reports correctly exposed these gaps:

- **Not complete:** a reusable application dropdown component; arbitrary keyboard
  shortcut remapping; Saved-tab animation; SyncTeX directional arrows; moving the
  old Document view's “files used” information into Writing; and a true custom
  completion component (Monaco owns that DOM).
- **Partial:** TODO/FIXME parsing, explanatory copy, and clickable Writing-panel
  items are present. There is no editor-gutter decoration or creation command, so
  it must not be represented as complete editor integration.
- **Fixed in this audit:** generic Monaco suggestions are now disabled for non-TeX
  models; the Compile sidebar gets its own scrolling overflow; and the completion
  popup has TeXtra-shaped border/radius styling, though it remains Monaco's widget.
- **Fixed in this audit:** arbitrary PDFs now use a dedicated canonical project-PDF
  reader instead of the build-only reader that caused Preview to appear to do nothing.

Verification after these fixes: typecheck and 32 focused unit tests passed. A build
can intermittently fail to empty `out/renderer/assets` with Windows `EPERM`, likely
because a process or sync client holds a generated asset; the build succeeded before
the audit change, but needs a clean retry after the lock clears before claiming this
last slice is fully build-verified.

## Next action if interrupted

1. Inspect this file’s Findings and changes section for completed delegated slices.
2. Continue remaining cross-cutting items in the Actionable feedback list.
3. Run focused tests, then typecheck, lint, format check, and build as applicable.
4. Record results and remaining manual checks here.
