# Phase log

- 2026-10-21: Implemented prompted Ctrl+I insertion/selection editing, ghost-only
  automatic completion, restored compile shortcut and provider v4 management with
  silencing, custom endpoints, role visibility and standard Mistral FIM. Full
  unit 557/557 and serial native7/7 pass; static/build pass. Final live evidence and
  commit tracked in AI_SETTINGS_IMPLEMENTATION.md. Unrelated gates stay open.

- 2026-10-21: Revised automatic completion to 1–10 lines/384 tokens, 30s local/10s
  remote deadlines and installed Qwen0.5B preference for new bindings. Generic word
  suggestions are off; deterministic suggestions require command/structured-argument
  context. Full unit suite passes 494/494; saved automatic model switched to local
  0.5B through validated IPC. Live figure fixture returned four lines in 13.669s.
  Native completion/shell checks pass 2/2; typecheck, lint, changed-file formatting
  and production build pass. No unrelated phase gates advance.

- 2026-10-21: Fixed Qwen cancellation and TexLab timeout follow-up. Local native
  generation stops on useful output/suffix, local context/deadlines fit CPU
  inference, and normal cancellation is quiet. TexLab sync/query feedback loop
  removed, stale work cancelled and queues bounded. 488 unit/integration tests
  pass; real Qwen automatic/manual and bundled TexLab checks pass. No phase gates
  advanced. Restart npm run dev to load main/preload fixes.

- 2026-10-21: Inline completion slice: independent AI role defaults/session
  selections, atomic v3 migration, automatic consent and environment-aware
  suggestions, Ctrl+I continuation toolbar, native FIM/chat routes and guarded
  undoable insertion. 470 unit/integration tests pass serially; native completion,
  shell and Agent pass. Live provider evidence is partial, as detailed in TESTING.
  GitHub deferred; no unrelated roadmap gates completed. Launch npm run dev.

- 2026-10-18: Inspected empty directory, initialized Git, wrote product specification,
  operating instructions, architecture/security documents and project memory.

- 2026-10-18: Phase 0 complete: 45 unit/service tests, native Playwright smoke, production build, typecheck/lint/format, CSS HMR, preload reload and main restart passed. Initial milestone commit follows.
- Foundation commit: 345fb44.
- 2026-10-18: Core Phase1 IDE slice: safe projects/editor/conflict recovery, fixed
  real TeX pipelines, PDF.js/SyncTeX, settings/project overrides/setup compile.
  138 tests and2 native workflow tests pass. Full Phase1 remains open; see roadmap
  and CURRENT_STATE for exact next work. Core IDE commit: ea4c1ef. Final HMR,
  preload reload, main restart and static/build checks passed; clean checkpoint.
