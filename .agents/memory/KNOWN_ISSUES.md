# Known issues

- 2026-10-27 Visual editor verification: Windows functional, shared-Yjs and document-session cases pass. macOS/Linux, broader IME composition and 125%/150% scaling have not been verified. A synthetic 500,000-character adapter fixture took 3,770 ms to import and 103.1 ms median per cloned localized edit; parsing is off the UI thread, but large documents may still show editing delay. Packaged cold launch remains unmeasured.

- 2026-10-25 collaboration milestone remains incomplete: plain-file auto-merge is
  intentionally deferred and uses manual review; watcher/outbox failure injection,
  delayed-sidecar/copy-folder cases, concurrent history-index mutation, and
  macOS/Linux gates remain unverified on `feature/crdt`. The Windows native suite
  includes and passes a two-profile shared-folder collaboration case; see
  `docs/TESTING.md`.

- 2026-10-24 UI audit follow-up: no reproducible UI defects remain from the
  requested views. The app has no existing LaTeX logo asset; the current tool icon
  remains. The narrow editor toolbar is horizontally scrollable within its pane.

- 2026-10-24 startup troubleshooting: the black development window from an
  unoptimized CommonJS parser dependency was fixed by adding the missing renderer
  dependency to Vite's optimize list. The expanded native smoke passes startup,
  CSS HMR, preload reload, and main-process restart. The CDP harness selects the
  renderer URL and uses an ephemeral debugging port. Windows/Dropbox may still deny
  Vite cleanup of the generated `out/renderer/assets` reparse point; the verified
  build-host workaround is documented in `docs/UI_AUDIT.md`.

- 2026-10-24 architecture follow-up:
  - Confirmed history containment, corrupt-index preservation, restore data loss,
    stale Monaco replacement, overlapping saves, watcher/process lifetime and framing
    defects are fixed; see docs/ELECTRON_AUDIT.md for scope and evidence.
  - Portable Node checks cannot eliminate a hostile concurrent filesystem TOCTOU race.
    Interrupted history publication may leave unindexed bytes; legacy import retains
    originals. These are documented limits, not claims of atomic OS directory handles.
  - macOS/Linux native behavior, installers/migration release checks and genuinely
    cold packaged launch measurements remain open. No live provider calls in this slice.
  - Windows/Dropbox can hold the generated out/renderer/assets directory during Vite
    cleanup. Verified empty-directory removal using native PowerShell allowed rebuild;
    no source or user files were deleted and application write safety was not relaxed.
  - Native Monaco tests must await logical editability after save acknowledgement.
    Disk publication precedes history completion; native textarea readonly alone is
    insufficient. Installed Monaco exposes readOnly through aria-autocomplete.

- 2026-10-22 SDK assistant UX follow-up: the native chat e2e now passes with the Chat/Agent
  controls present, covering provider onboarding, Markdown, reasoning display and retries.
  Native Agent staging and sequential multi-hunk approval remain separate checks. Targeted
  runtime/assistant tests passed 48/48 at the earlier checkpoint. Agent latency still depends on provider/model
  speed and the extra model turn required after an edit tool call. Sending the active
  snapshot removes the separate initial read round trip but does not remove those turns.
  The captured Gemini request in the user's log reached Google's API and received HTTP 503
  high demand (not a local connection failure). The UI now reports provider unavailability
  and the safe provider detail. Thinking is reduced for the default Flash-Lite model; genuine
  provider congestion can still delay or reject requests. No live provider request was made
  during this fix.

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

- 2026-10-25 conflict workflow now uses the inline banner for both manual review and
  background-merge fallback; the stale test expectation for a modal was updated and
  native project/collaboration/history/Agent flows pass serially. Keep Playwright runs
  serial because they clean shared test-results. Dropbox may lock generated renderer
  output during a build; `TEXTRA_PRESERVE_RENDERER_OUTPUT=true` remains the verified
  build workaround.

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
- 2026-10-23: Monaco/PDF.js and optional renderer features now load separately, with
  production minification and a 485.33kB initial renderer entry. The final managed-run
  benchmark observed a 17.074s median normal-sized editable document; the two-second target remains
  unmet. The initial timing fixture had invalid preferences and
  must not be used to claim a launch-time improvement. See docs/PERFORMANCE.md.
  Windows managed output directories can retain read-only sandbox ACLs; the verified
  empty generated out/renderer/assets directory needed removal outside the sandbox
  before a successful rebuild. Never weaken application atomic writes to work around it.
- Phase 2 implementation is complete, but the full platform/native interaction matrix remains
  open. Current Windows shell, editor, Agent/Chat, startup and settings native checks can bind
  real Electron windows successfully; macOS/Linux and the remaining gate matrix still require
  verification. ChkTeX and latexindent are optional PATH tools; TeXtra keeps local
  reference and writing analysis available when they are absent.
- AI SDK migration (2026-10-21) was verified in a Linux container only. Re-run the serial
  Windows e2e suite and an opt-in live check (`TEXTRA_LIVE_AI_TEST=1`) before committing.
  Settings switches are controlled inputs, so e2e tests click and then assert state rather than
  using Playwright check/uncheck.
