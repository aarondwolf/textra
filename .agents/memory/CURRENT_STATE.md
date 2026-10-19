# Current state

2026-10-18 Project recipes checkpoint: canonical .textra/settings.json is generated
on explicit folder/recent open, safely migrates legacy project.json without deletion,
accepts JSONC, and preserves invalid/future files. Popup builder and JSON view edit
defaults/new named recipes, ordered tools, output/aux paths, SyncTeX and project
default. Same Workshop recipe/tool keys and documented placeholders; commands,
flags, env and paths remain allowlisted. Compile loads disk settings afresh, saves
per-document selection only when changed, and avoids unnecessary comment rewrites.
Expected snapshots prevent stale popup overwrite; bounded Windows lock retries keep
rechecking paths/conflicts. Explorer clicks are disabled during async project changes.
Configured outputs default to build/textra/%RELATIVE_DOC%; never auto-pruned. Direct
MiKTeX supports separate aux; latexmk/TeX Live require aux=out. Stable PDF outputs
carry pdfVersion so the viewer reloads bytes; failed sidecar mapping is disabled.
Verified 179 tests in 16 files, all three native workflows, typecheck, lint, format,
production build. Native includes builder/JSON/external edits, stale save conflict,
same-path PDF text refresh and existing no-data-loss workflows. docs/RECIPES.md and
recipe-builder.png document compatibility and limits. Full Phase 1 remains open for
installer/manager, custom executable paths, explorer folder collapse/reveal-active,
persisted font/wrap and wider platform/PDF validation. Earlier UI follow-ups are
included in this checkpoint; sandbox/.textra remains untracked manual project data.

2026-10-18 Empty-state follow-up (working tree): Recent Projects now uses a native
keyboard-accessible details/summary disclosure, collapsed by default and anchored
at the explorer bottom. Its expanded list scrolls independently. Replaced the large
welcome copy with a 22px heading, one sentence and one action; PDF empty state is
also smaller and concise. Typecheck/lint/format pass; production build and native
shell smoke pass after retrying a transient Windows output-directory lock. Native
empty-state screenshot visually reviewed.

2026-10-18 Tab styling follow-up (working tree): source file tabs are inset 28px
rounded rectangles with a filled active state and transparent inactive state. Removed
full-height tab dividers/active underline. Inactive close controls appear on hover or
keyboard focus; dirty indicators and focus outlines remain. Production build and
native project workflow pass; screenshot visually reviewed and updated.

2026-10-18 Activity rail follow-up (working tree): added Files icon for File Explorer
and Blocks icon for Extensions. Explorer opens the existing project tree; Extensions
opens a clearly labeled future-extension placeholder. Active view is highlighted;
collapse and Settings remain separate. Sidebar view switches preserve documents and
dismiss file menus. Typecheck, lint, formatting, build and native shell smoke pass.

2026-10-18 Compact controls follow-up (working tree): Compile/recipe, Preview,
Problems, Output and collapse now share one compact row. Removed explorer bottom
action bar. Left-clicking an entry opens an accessible action menu (files also open
in editor); right-click/Shift+F10 work too. Rename/Delete keep existing save and
confirmation protections; Reveal/VS Code retain narrow bridge actions. Native
workflow passes with menu/rename-cancel checks and measured toolbar alignment;
typecheck, lint, formatting and build pass. Screenshot updated.

2026-10-18 Workspace layout follow-up (working tree): removed app header/footer and
PDF footnote. Left activity rail provides sidebar collapse, commands and bottom
Settings; theme selection is inside Settings. Compile/recipe/cancel now live in
Preview pane with Preview/Problems/Output tabs. Builds do not switch views or reveal
logs. Preview collapses sideways, expands editor and preserves mounted PDF state;
previewVisible is persisted with legacy preference migration. PDF search is hidden
until scoped Ctrl/Cmd+F; Escape closes. Ctrl/Cmd+H routes to source replace, with
Monaco find contribution explicitly loaded. Verified 116 focused tests, typecheck,
lint/format/build, shell persistence and native project workflow including PDF
search/replace, collapse, tab selection, real compile and settings-failure handling.
README and docs/screenshot.png reflect current UI. Existing untracked sandbox
project settings remain preserved.

2026-10-18 Compile follow-up (working tree): renderer fills missing recipe defaults
from older loaded preferences. Compile no longer disables on tool discovery results;
it attempts the selected allowlisted compiler and exposes errors. Optional recipe
persistence failures warn without preventing compilation. Disabled states explain
missing active .tex/current file operation and use not-allowed rather than wait.
Verified 24 focused tests, typecheck/lint/format/build and the native project workflow
with legacy preferences and an injected recipe-save failure. Sandbox project settings
created during manual testing are preserved as untracked user data.

2026-10-18 UI refinement checkpoint: removed the build toolbar row. A top-bar
Compile split button builds only the active .tex tab; recipe choices persist per
document in .textra/project.json on compile. Settings provides the portable default
recipe; old preferences and explicit root/engine settings remain readable. Open
folder is an explorer icon. Verified 65 focused tests, native project workflow
(including active-tab target, recipe restoration and new-document default), lint,
typecheck and production build. User sandbox/test.tex is preserved.

2026-10-18: Foundation complete; core Phase 1 workflow implemented. Full Phase 1
is incomplete. Last passing implementation commit: ea4c1ef (core IDE).
Foundation commit: 345fb44. All implementation and verification are committed.

Working: selected local roots, bounded explorer, UTF8 Monaco tabs/undo, safe saves,
create/rename/trash, recent/pinned projects, file-manager/VSCode actions, revision
conflicts, unsaved close/switch checks, TeX discovery, fixed presets, real bounded
cancellable builds, diagnostics, PDF.js pages/zoom/search, two-way SyncTeX including
chapters, settings import/export, project overrides and setup test compile.
No AI/network source sharing. See KNOWN_ISSUES for remaining features/limitations.

Evidence: typecheck/lint/build pass; 138 tests in 12 files pass including real
MiKTeX/BibTeX/latexmk/SyncTeX and filesystem junctions. Expanded native workflow
passes editing/conflicts/five-page PDF/settings/setup/unsaved-discard/reopen.
Final shell/reload checks passed, along with format/typecheck/lint/build/diff checks.

Next three actions:

1. Finish Phase 1 editable allowlisted pipelines and distribution install/manager
   workflows with current metadata and explicit in-app user confirmation.
2. Persist font/wrap, add context menus/collapsible tree/reveal-active and TEX-root
   hints; validate additional engines and PDF crop/rotation/zoom navigation.
3. Complete full Phase 1 acceptance matrix before proceeding to Phase 2.

Launch: `npm run dev`. Checks: format:check, typecheck, lint, test, build,
test:e2e, test:dev. Desktop permissions may be needed for sandbox-blocked output
cleanup/junction tests. No installers, signing or cross-OS behavior verified.
