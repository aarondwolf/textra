# Refactor and dependency review

The incremental refactor is in progress. Workspace explorer and tab presentation,
Monaco language setup and editor context helpers, and AI IPC registration have
been separated into feature-owned modules. IPC still passes through the shared
sender validation and lifecycle admission wrapper. Document session ownership,
persistence formats, and preload capabilities are unchanged.

## Library decisions

- Document structure uses `unified-latex`; bibliography uses
  `@retorquere/bibtex-parser`. The cursor completion scanner remains custom:
  incomplete commands and literal blocks need cursor-bounded state beyond the
  parser's result. Existing focused completion and structure tests cover this.
- The FIFO mutex is small and includes a flush barrier used by persistence.
  Atomic writes and retry logic implement project-specific publication, validation,
  and Windows lock handling. Keep these until a candidate demonstrates those
  guarantees with the existing failure tests.
- Radix, Monaco, PDF.js, the AI SDK, and other existing libraries already own the
  corresponding UI and protocol foundations. Additional control, streaming, and
  dependency reviews remain open; this is not a complete dependency audit.

## Remaining work

Continue decomposing workspace controllers, settings, AI service, shared API,
styles, PDF, chat, and visual editor incrementally. Establish focused behavior
coverage before each move, then run the full gate and native smoke. Cross-platform
Phase 1 verification remains open. Review startup and bundle measurements when
changing loading boundaries or dependencies.

## Verification of this slice

Typecheck, focused lint, production build, native shell, and native explorer
checks passed. Focused editor and LaTeX parser/completion suites passed 42 tests.
The project workflow native test failed before opening a project: it expected a
compile-button `title` attribute that was absent. The full suite was interrupted
after sandbox localhost denials and, on an unrestricted concurrent rerun, real
TeX recipe timeouts; it has not passed. The repository-wide formatting baseline
reported 114 files, so only changed source files were formatted. No phase gate
has advanced.
