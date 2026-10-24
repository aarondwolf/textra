# Roadmap

This file tracks unfinished work only. Current product behavior is described in the
README and focused guides; test evidence and phase history live in `.agents/memory/`.
Do not mark a gate complete until its acceptance checks pass.

| Gate                                 | Remaining work                                                                                                       | Status  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------- |
| Phase 1: cross-platform verification | Run the editor, compile, PDF, SyncTeX, crop and rotation matrix on macOS/Linux.                                      | Open    |
| Phase 2: verification                | Complete the native interaction and platform test matrix in [Testing](TESTING.md).                                   | Open    |
| Phase 3: research tools              | Decide and implement bibliography workflows, Git/history, Beamer, presentation controls and remaining writing views. | Planned |
| Phase 4: release                     | Accessibility review, migrations, installers, TeX setup help and Windows install/uninstall release matrix.           | Planned |

### Deferred interface work

- Evaluate replacing the activity rail with a labelled sidebar switcher.
- Highlight the outline section containing the editor cursor.

### Startup performance verification

- Profile packaged desktop warm/cold launches, native/module initialization and first
  content paint. The 2026-10-24 warm-profile run observed a median 2.133s to an
  editable editor; the two-second warm/four-second cold investigation targets remain open.
  See [Performance](PERFORMANCE.md) for evidence and limitations.

### Release requirement

Before public release, verify encrypted userData credential migration and OS storage
on each supported platform. Migration preserves the legacy source and never replaces
an existing store. See [Security](SECURITY.md).

Run the full gate with `npm run format:check`, `npm run typecheck`, `npm run lint`,
`npm test`, `npm run build`, and `npm run test:e2e`. Record exact evidence and blockers
in `.agents/memory/TESTING.md`.
