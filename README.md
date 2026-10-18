# TeXtra

A modern, local-first LaTeX desktop IDE. Your documents stay ordinary files on
your computer. Editing and local compilation never require an account; AI is
optional and planned for a later phase.

![Native TeXtra editing and PDF preview](docs/screenshot.png)

## Current status

- [x] Phase 0: native Electron shell, themes, pane controls, command palette
- [x] Core IDE: real folders, Monaco tabs, safe saves, local builds, PDF.js, SyncTeX
- [x] Recent/pinned projects, file CRUD, portable settings, project build preferences
- [ ] Full Phase 1: custom pipelines, installer management, further workflow polish
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

1. Choose **Open folder**, then select a `.tex` file in the explorer. Multiple tabs
   preserve editor models and undo while open. Use Ctrl/Cmd+S to save, Shift+Ctrl/Cmd+S
   to save a copy, and Monaco's Ctrl/Cmd+F or Ctrl/Cmd+H for search/replace.
2. Choose the root document and compiler. **Compile** (Ctrl/Cmd+Enter) saves all
   dirty files first. Presets: direct pdfLaTeX, XeLaTeX, LuaLaTeX, latexmk, and
   pdfLaTeX → BibTeX → pdfLaTeX twice. Cancel stops the process tree.
3. Inspect Output or source-linked Problems. Successful PDFs load beside the
   editor. Navigate pages, zoom/fit width, search, or use **Go to source line**.
   Double-click the PDF to jump back to source with the installed SyncTeX tool.

External changes produce a conflict notice. Your open buffer is retained; reload
only after explicitly discarding it, or save a separate copy. Save As never replaces
an existing file. Closing/switching checks unsaved edits. Delete uses the OS trash.

The gear button opens **Settings & TeX setup**: detected tools, re-detection, a real
temporary test compile, official installer pages, project preferences, and settings
import/export. No installers or missing packages run automatically. Windows uses
MiKTeX/TeX Live; macOS can use MacTeX; Linux users should use their distribution's
TeX packages. Restart after PATH changes. Installer/manager actions remain planned.

Layout/theme and recents live in Electron userData. Explicitly save root/compiler
choices to `.textra/project.json`. Import/export accepts only versioned theme/layout
settings; unknown schemas and corrupt files are preserved. Recent folders, keys and
tool paths are excluded. AI setup, key storage and cost controls remain planned;
no credentials are currently stored or migrated. Offline operation is the default.

Builds use unique `build/textra/` directories and retain the last successful PDF
through failures. Only this session's generated directories are pruned (five recent
builds); older session outputs may need manual cleanup.

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
- Conflict: Save As preserves your buffer; Reload from disk requires confirmation.
- Invalid project settings: preserve and inspect `.textra/project.json`; move it
  aside manually before recreating settings. Do not delete it blindly.
- Development startup: install dependencies and run typecheck/build for actionable errors.
- Dropbox/OneDrive: the development dependency cache lives in OS temp to avoid
  sync locks. If output cleanup reports EBUSY, close the running app before rebuilding.

Source content stays local. TeX input is powerful: compile trusted projects only.
See [security](docs/SECURITY.md), [architecture](docs/ARCHITECTURE.md),
[testing](docs/TESTING.md), [roadmap](docs/ROADMAP.md), and the complete
[feature specification](docs/FEATURE_SPEC.md).

License: **pending owner decision; no open-source license granted yet.**
