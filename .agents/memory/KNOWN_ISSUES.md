# Known issues

- Environment: managed sandbox blocks npm DNS and atomic rename in sandbox temp.
  Approved npm install works; tests now use workspace test-results and pass inside
  sandbox. Native Electron checks need desktop execution. Preserve atomic writes.
- Unimplemented phases are tracked in docs/ROADMAP.md, not advertised as complete.
- Packaging, signing, cross-platform behavior and installer UX remain unverified.
- Phase 1 partial: install/manager actions, custom executable paths, explorer folder
  collapsing/reveal-active, font/wrap persistence and broader platform/PDF validation
  remain. Editable project recipes and PDF-beside-source output now work; the user's
  active-document compilation rule supersedes TEX-root redirection.
- Recipe compatibility covers Workshop recipe/tool shapes and documented placeholders,
  with a narrower command/argument/env allowlist. Separate aux currently needs direct
  MiKTeX engines; use %OUTDIR% for latexmk/TeX Live. See docs/RECIPES.md.
- Real Windows integrations verified for pdfLaTeX/BibTeX/latexmk/SyncTeX only;
  XeLaTeX/LuaLaTeX and macOS/Linux need additional real testing.
- Portable Node checks cannot eliminate hostile concurrent filesystem TOCTOU
  races. TeX itself is not sandboxed; compile trusted documents.
- Configured recipe output folders are never automatically pruned; legacy fixed
  build retention prunes current-process directories only. PDF search covers page matches (first 2,000 pages), with no
  text selection/highlights. Crop/rotation SyncTeX cases need broader fixtures.
- Renderer includes Monaco/PDF.js (~6.5MB); lazy loading remains performance work.
  No critical runtime/data-loss failure remains known after the bounded review.
