# Known issues

- 2026-10-21 prompted-edit native blocker resolved: interactive Monaco view zone
  exposes its form to accessibility, defers focus until painted and raises its
  pointer layer above source lines. Native acceptance passes for typing, selected
  replacement, ghost insertion/Undo and Ctrl+Enter. See AI_SETTINGS_IMPLEMENTATION.md
  for live-provider limitations and remaining external checks.

- 2026-10-21 automatic-completion revision: saved automatic binding is local
  Qwen2.5-Coder0.5B. A live synthetic supply/demand figure returned four lines in
  13.669s; cold/larger requests can still exceed the 30s local bound. Output quality
  remains model-dependent; ten lines is a maximum, not a required length.

- 2026-10-21 local Qwen timeout follow-up is resolved for the tested synthetic paths:
  native generation now stops before echoed closing source/explanations, local
  context is smaller. At that checkpoint CPU deadlines were 10s automatic/30s
  Ctrl+I; the later multiline revision raises local automatic to 30s. Live Qwen3B
  Ctrl+I and the consented Qwen1.5B automatic model return valid insertions. Large
  buffers/cold CPU models can still exceed bounded deadlines; no automatic fallback.
  The dedicated Codestral profile is retired; standard Mistral now owns FIM. The existing
  Google encrypted key cannot decrypt in the isolated native test profile; retry
  a live Google check from its intended desktop profile. This does not establish
  that the credential is invalid in the owner's normal app session. Synthetic/mock
  contracts and native editor behavior pass separately.
  Automatic remains disabled unless explicitly enabled with native model consent.

- 2026-10-20 native project-workflow test still expects the previous inline external-change
  banner (line108), while the existing working tree shows the new External change detected
  dialog. Reconcile that test with the owner's in-progress conflict workflow; Gemini work
  preserves it. Native shell and recipes pass serially with desktop permissions. Do not run
  Playwright invocations concurrently: they clean shared test-results, corrupting profiles
  and traces. Stop native app/test runs before rebuilding generated output.

- Environment: managed sandbox blocks npm DNS and atomic rename in sandbox temp.
  Approved npm install works; tests now use workspace test-results and pass inside
  sandbox. Native Electron checks need desktop execution. Preserve atomic writes.
- Unimplemented phases are tracked in docs/ROADMAP.md, not advertised as complete.
- Packaging, signing, cross-platform behavior and installer UX remain unverified.
- Phase 1 verification remains: new UI (collapsible tree, reveal-active, PDF match
  highlights, custom tool paths, persisted font/wrap) was typechecked and linted but
  not exercised in a native run. TeX install/manager help is deferred to Phase 4.
  TEX-root redirection is intentionally unsupported; Compile builds the active tab.
- PDF match highlights use per-item proportional offsets, so boxes are approximate and
  matches split across text items are listed by page but not boxed.
- Recipe compatibility covers Workshop recipe/tool shapes and documented placeholders,
  with a narrower command/argument/env allowlist. Separate aux currently needs direct
  MiKTeX engines; use %OUTDIR% for latexmk/TeX Live. See docs/RECIPES.md.
- The owner manually verified XeLaTeX and LuaLaTeX compilation on Windows. Cross-platform
  verification and crop/rotation SyncTeX fixtures remain; the owner has not manually
  tested SyncTeX in this current UI round.
- Portable Node checks cannot eliminate hostile concurrent filesystem TOCTOU
  races. TeX itself is not sandboxed; compile trusted documents.
- Configured recipe output folders are never automatically pruned; legacy fixed
  build retention prunes current-process directories only. PDF search covers the first 2,000 pages and has no text selection. Crop/rotation SyncTeX cases need broader fixtures.
- Renderer includes Monaco/PDF.js (~6.5MB); lazy loading remains performance work.
  No critical runtime/data-loss failure remains known after the bounded review.
- Phase 2 implementation is complete, but the final native interaction pass remains pending.
  In the managed runner, Electron reaches `application-ready` then exits before the UI automation
  service can bind a window. ChkTeX and latexindent are optional PATH tools; TeXtra keeps local
  reference and writing analysis available when they are absent.
