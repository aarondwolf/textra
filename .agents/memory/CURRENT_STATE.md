# Current state

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
