# TeXtra

A modern, local-first LaTeX desktop IDE. Your documents stay ordinary files on
your computer. Editing and local compilation never require an account; AI is
optional and planned for a later phase.

> Future screenshot: a verified application screenshot will be added here later.

## Current status

- [x] Phase 0: native Electron shell, themes, pane controls, command palette
- [ ] Phase 1: editing, local compilation, PDF preview, SyncTeX
- [ ] Phase 2: writing tools, diagnostics, optional AI
- [ ] Phase 3: research and presentation workflows
- [ ] Phase 4: installers and distribution

## Development

Prerequisites: Node 24 LTS, npm 11; optional MiKTeX/TeX Live/MacTeX for compilation.
Git is recommended. No API key is needed. Open this repository and run:

```powershell
npm install
npm run dev
```

Validation: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`,
`npm run build`, `npm run test:e2e`. Installer packaging is not configured yet.
The primary iteration loop is a native Electron window with React HMR.
`npm run test:dev` verifies HMR and main/preload reload behavior; run it without
concurrent source edits because it temporarily appends and restores test probes.

## Workflow and setup

Use Ctrl/Cmd+K for commands, Ctrl/Cmd+B for the sidebar, Ctrl/Cmd+J for the bottom
panel, and drag the split or use arrow keys on it. Themes and layouts are saved
to `preferences.json` in Electron userData (`%APPDATA%/TeXtra` on Windows).
Open-folder/edit/compile/preview controls will be documented as they are verified.
TeX discovery uses installed executables; installation is never automatic. Windows
users can install MiKTeX or TeX Live, macOS users MacTeX, and Linux users their
distribution's TeX Live packages. Restart TeXtra after PATH changes. Installer
launchers and distribution management are planned.

AI provider setup, cost controls, key storage, settings import/export, and project
overrides are planned. No credentials are stored or migrated in this foundation.
Offline operation is the default. Future settings use Electron userData and
optional `.textra/project.json`; exports must never contain keys.

## Architecture and contribution

`src/main` owns files/processes; `src/preload` is the narrow typed bridge;
`src/renderer` contains the UI; `src/shared` defines contracts; `tests` contains
fixtures and verification. Read [AGENTS.md](AGENTS.md) before contributing.
Run all checks before a change is considered complete.

## Troubleshooting

- Missing TeX: check `pdflatex --version` and restart after changing PATH.
- Failed build: inspect the full Output panel; missing packages may need your distribution manager.
- SyncTeX: requires the executable and output produced with `-synctex=1`.
- PDF preview: a failed compile may leave no new PDF; use the last successful build.
- Development startup: install dependencies and run typecheck/build for actionable errors.

Source content stays local. TeX input is powerful: compile trusted projects only.
See [security](docs/SECURITY.md), [architecture](docs/ARCHITECTURE.md),
[testing](docs/TESTING.md), [roadmap](docs/ROADMAP.md), and the complete
[feature specification](docs/FEATURE_SPEC.md).

License: **pending owner decision; no open-source license granted yet.**
