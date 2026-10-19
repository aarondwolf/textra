# Current state

2026-10-19 Phase 1 checkpoint: owner manually verified XeLaTeX and LuaLaTeX compilation.
SyncTeX remains untested in this UI round; macOS/Linux and crop/rotation fixture coverage
remain follow-up verification. The Phase 1 implementation is being committed as the
checkpoint before the offline language tooling and diagnostics Phase 2 slice.

2026-10-18 Snippets sidebar view (working tree): rail button with a "{ }" glyph
(sidebarView 'snippets'). features/snippets/snippets.ts holds 12 built-in snippets (table,
table with notes, figure, figure with subfigures, lists, equation, align, theorem and
proof, minipages, section, footnote). Double-click or Enter inserts through the same
textra:insert-source event as the equation palette; hovering shows needed packages. No
user-defined snippets yet. Owner confirmed equation double-click works. Not run natively.

2026-10-18 Equations moved to the left sidebar (rail button with sigma, sidebarView
'equations'); it has an Environments group (equation, align, matrices, cases, inline/display
math). Insert event is cancelable so the palette reports failure. Earlier note: Equations tab (working tree), originally a preview tab. features/equations/ holds a searchable palette of about 300 symbols in 14
groups (structures, Greek, operators, relations, arrows, big operators, sets, delimiters,
accents, functions, spacing). Double-click or Enter inserts at the cursor through a
textra:insert-source window event handled in SourceEditor (replaces the selection, cursor
lands at $0 or inside the first {}). Hover/focus shows the LaTeX and any needed package.
Glyphs are Unicode, no math renderer dependency. Not run natively.

2026-10-18 Compile progress (working tree): BuildState gained optional stepsDone/stepCount
(set in BuildService around the recipe step loop). The Compile/Cancel button fills via a
--progress CSS variable: (done + 0.5) / count, capped at 95%, animated with @property.
Step-based only; no page-count estimate. Drop-downs in Settings/Recipes/PDF controls are
themed (native open list still OS-drawn). Recipes and tools are edited separately, with a
draft-mode helper for early passes. Not run natively.

2026-10-18 Preview/Settings round (working tree): PDF page, zoom and locate controls now
render in the preview header (React portal into .pdf-slot) beside Compile and the Preview/
Problems/Output tabs; below 560px header width they collapse into a "..." menu. Output tab
has a Copy button in the header. Editor tab strip and preview header share --bar-height
(40px, border-box). Settings is a dialog with a section list (Appearance, LaTeX tools,
Compilation, Import & export); LaTeX tools rows show the path with a pencil (and an undo
icon for custom paths). Build recipes dialog opens on a recipe list (pencil per recipe),
Output location radios (build folder / PDF beside .tex with aux in build / custom), default
recipe, and settings.json link; the per-recipe editor has steps, toggle chips with
explanations for tool arguments, locked chips for managed arguments, and a %TAG% glossary.
Logic lives in src/shared/recipe-help.ts (unit tested). Not run natively. Someone else is
migrating lucide to Phosphor via src/renderer/src/icons.tsx; added Hammer, Palette, Wrench,
Undo2 there. VM typecheck reports missing Phosphor types (node_modules not installed here).

2026-10-18 PDF jitter fixes (working tree): page renders to an off-screen canvas and swaps
in one step (resizing the visible canvas cleared it); fit-width resize is debounced 120ms and
the scroll area reserves its scrollbar (scrollbar-gutter) to avoid width feedback loops;
scroll position scales with page height on re-fit; recompiling keeps the old document on
screen until the new one loads (no canvas unmount); search highlights are computed in a
separate effect so searching no longer re-renders the bitmap. Not verified natively.

2026-10-18 Folding icon fix (working tree): the box glyph came from the minimal Monaco
entry omitting codicon.css (icon font), which also affects find/suggest widget icons. The
font CSS is now imported by relative node_modules path (package exports cannot address
.css) and fold controls are drawn as small +/- masks in styles.css, shown on gutter hover
when open and always when folded. Not verified natively.

2026-10-18 Round 4 (working tree): explorer folders now start collapsed (expandedFolders
set; opening a file or reveal-active expands its ancestors). Folding was still dead after
the contribution imports because deep monaco imports were not in Vite optimizeDeps.include,
so they loaded as separate raw modules whose registrations the pre-bundled editor never
sees; all Monaco entry points are now listed. e2e asserts folding icons exist and nested
files are hidden at start. Not run natively: restart npm run dev fully to rebuild the cache.

2026-10-18 Explorer/editor round 3 (working tree): root cause of dead folding was the
minimal Monaco entry (editor.api.js) lacking the folding, bracketMatching and comment
contributions; they are now imported. Sidebar is resizable (persisted sidebarWidth
160-480, drag/arrow keys/double-click reset). All sidebar icon buttons have tooltips.
Context menu reads Open in File Explorer / Open in VS Code. New file/folder create
inline in the tree beside the selection (Enter creates, Esc/blur cancels, names only).
Owner decision: explorer shows literally everything (build/, .git, .textra, aux files);
validateRelativePath no longer blocks protected names, so rename/delete work on them
(delete uses the OS trash, with confirmation). .git and node_modules are listed but not
walked so the 10,000-entry limit cannot hide real files. Compile still refuses
.git/.textra/node_modules roots in latex.ts. Not run natively; if folding is still
absent, check Vite dev-server re-optimization of the new monaco deep imports.

2026-10-18 Explorer/editor fixes (working tree): file clicks no longer open the actions
menu; it opens on right click, Shift+F10/Menu key, or the "..." button on the selected
row. Project name header is an inert label; rows are flush left with 14px per folder
level. Folding now uses a LaTeX FoldingRangeProvider (environments, sectioning, comment
runs; features/editor/folding.ts) because Monaco's default indentation folding cannot
fold unindented LaTeX. Folding logic was run directly on fixtures in a Linux VM; UI
behavior still needs a native check.

2026-10-18 Phase 1 completion slice (working tree, uncommitted): explorer subfolders
collapse with chevrons and open/closed icons (root has no chevron); Copy Path and Copy
Relative Path in the context menu (handler moved to its own IPC registration);
reveal-active button; window-focus project refresh; Monaco folding and LaTeX theme;
font size and word wrap persisted in preferences; custom executable paths per TeX tool
(absolute path whose file name must match the tool, stale override reports not found);
PDF search highlights with previous/next match; shared inset selection styling.
Owner decisions: TeX install help moved to Phase 4; TEX root unsupported. Verified in a
Linux VM: typecheck, lint, format; preference validation logic run directly. Vitest,
build and native Electron checks could not run there (Windows native binaries) and
must be run on Windows: npm test, npm run build, npm run test:e2e.

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

2026-10-18 Sidebar identity follow-up (working tree): Lucide replaced by Phosphor via
src/renderer/src/icons.tsx. Extensions placeholder removed. New Document sidebar view
(features/document/DocumentView.tsx) shows the active .tex file's outline with included
chapters spliced in, and a tree of used files with missing/circular markers; parsing
lives in src/shared/tex-structure.ts and document-model.ts (tests/unit/tex-structure.test.ts).
Sidebar headings are serif sentence case; selection is pill shaped. Not yet verified in
the native window; package-lock.json needs `npm install` on Windows after the dependency swap.

2026-10-18 Pill language and Document view layout (working tree): tabs, compile control,
preview tabs, toolbar/PDF controls, icon buttons and menu rows share --radius-pill; menus and
popovers use --radius-surface (styles.css :root). Document view sections are collapsible, the
Outline/Files used boundary is a keyboard-accessible splitter, and Files used defaults to a
150px pane at the bottom; layout persists in localStorage (textra.documentView). electron.vite
config now pre-bundles @phosphor-icons/react instead of lucide-react. Checked in headless
Chromium against the production renderer build with a stubbed window.textra (not Electron).

2026-10-18 Full-width preview (working tree): preview header has an Expand/Restore button
and the palette has Toggle full-width preview. State is session-only (useUI.previewExpanded,
not a saved preference). The editor pane is hidden, not unmounted, so Monaco state survives.
Opening a file or jumping to a source line (explorer, problems, PDF double-click) restores the
split. Not visually verified: the renderer build in the Linux shell currently fails with EMFILE
on material-icon-theme's SVG glob. Typecheck and lint pass.

2026-10-19 Expand panes (working tree): useUI.expandedPane ('editor' | 'preview' | null,
session-only) replaces previewExpanded. Editor tab actions and the preview header each have a
diagonal-arrows (Phosphor ArrowsOutSimple/ArrowsInSimple) expand/restore button; the palette has
Toggle full-width editor and Toggle full-width preview. Expanding the editor hides the preview
pane (Ctrl+Enter still compiles); closing the last tab restores the split. Verified in headless
Chromium against a production build (state transitions and screenshots). To build in the Linux
shell, use a local copy of src with node_modules/material-icon-theme copied locally, since the
mount hits EMFILE on that package's SVG glob.

- Collapsed preview pane now shows a quick-access rail: expand, green compile/cancel circle, severity-colored alert (opens Problems), log icon (opens Output). The "Expand editor" button is commented out in Workspace.tsx; its state, palette command and effects are kept for a later decision.
