# TeXtra handoff

TeXtra is a local-first Electron + React + TypeScript LaTeX IDE. Electron main
owns files and processes; the sandboxed renderer uses only the typed preload
bridge in `src/shared/api.ts`. Read `AGENTS.md`, README, ROADMAP, ARCHITECTURE,
SECURITY, CURRENT_STATE, and DECISIONS before working. Preserve the user-owned
`sandbox/test.tex` and `sandbox/.textra/` working-tree changes.

## Current checkpoint

- HEAD: `1fae854 feat: bundle TexLab language tooling`
- Phase 1 is committed. The owner manually verified XeLaTeX and LuaLaTeX.
  SyncTeX UI verification, macOS/Linux, and crop/rotation fixtures remain open.
- Phase 2 has offline writing analysis, reference checks, ChkTeX integration,
  latexindent preview, unified Problems, writing utilities, and welcome recents.
- AI work, custom snippet libraries, and equation helpers are deferred by owner.

Recent commits: `320d42a` writing diagnostics, `682ffe6` Problems/saving,
`901d39f` welcome recents, `38b7f4c` optional language tools, `98edcb5` Copy
Prompt feedback, and `1fae854` TexLab.

## Problems and writing UI

Problems merges build, ChkTeX, reference, and TexLab diagnostics. Each error
has TeX Stack Exchange search, Copy Prompt, and unwired Ask in Chat pills. Copy
Prompt uses the main-process clipboard and shows a temporary check mark only on
success. The prompt includes the diagnostic plus source context.

The welcome screen shows five recent projects below an outline-only Choose a
Project Folder button.

## TexLab implementation

TexLab 5.26.0 is bundled for Windows x64:

- `resources/texlab/win32-x64/texlab.exe`
- pinned release metadata/SHA-256: `resources/texlab/manifest.json`
- GPL-3.0 text and source attribution: `resources/texlab/LICENSE.txt` and
  `resources/texlab/THIRD_PARTY_NOTICES.md`

`src/main/services/texlab.ts` is the stdio JSON-RPC/LSP client. It owns framing,
initialize/shutdown, timeouts, document sync, and server notifications.
`src/main/services/texlab-manager.ts` limits it to canonical project paths,
chooses bundled before PATH TexLab, and normalizes diagnostics. Do not expose
generic process or arbitrary LSP access to the renderer.

Main exposes only `getTexlabStatus`, `checkTexlab`, `syncTexlabDocument`,
`texlabRequest`, and `getTexlabDiagnostics`. The `texlabEnabled` preference is
default true, persisted/migrated in preferences, and disabling it stops TexLab.
Settings → LaTeX tools shows status/version/path, a persistent toggle, and an
executable health check.

`SourceEditor.tsx` accepts a `TexlabEditorAdapter` for completion, hover,
definition/references, symbols, folding, inlay hints, and markers. The adapter
in `features/editor/texlabAdapter.ts` maps LSP data to Monaco. Workspace passes
physical file URIs so TexLab can resolve includes and bibliographies, and it
keeps local completion/folding fallbacks when unavailable.

Development resolves the binary from `resources/`; a packaged app expects the
same tree under `process.resourcesPath`. No installer configuration exists yet.
macOS/Linux assets and installer resource copying are Phase 4 work.

## Completion widget fix

The owner reports that typing `\begin{item` shows no completion. Automatic
LaTeX quick suggestions are now enabled, but TeXtra uses Monaco's modular
editor build and had not imported the Suggest Controller contribution. It is
required to render and operate completion widgets. It is now imported in both
`SourceEditor.tsx` and Vite's dependency optimizer. Typecheck, lint, and the
production build pass; the development app reached `application-ready` after
the cache was rebuilt. Native interaction testing of `\\begin{item` and
Ctrl+Space remains the next check.

## Environment completion reliability

TexLab completion requests cross IPC and LSP asynchronously. Monaco cancels and
replaces requests while the user types, which made environment lists appear only
intermittently. `SourceEditor.tsx` now provides standard `\\begin{…}`
environments synchronously and suggests the closest unmatched `\\begin{…}` at
`\\end{…}`. The stack skips unescaped-comment text. Typecheck, lint, format
check, and production build pass; verify the two flows in the native window.

## Empty environment completion

Accepting a local `\\begin{…}` suggestion now creates the complete empty
environment with a cursor placeholder on the interior line. It deliberately
does not insert `\\item`, labels, captions, or other environment-specific
content. Context-aware environment templates are deferred to Phase 3. Typecheck,
lint, format check, and production build pass.

## Environment Enter fallback and TexLab diagnostics

The owner's terminal showed repeated `textra:texlab:request` failures. They are
TexLab request failures, not Electron crashes. To make paired environments
reliable without the suggestion widget or TexLab, Enter immediately after a
complete `\\begin{name}` now inserts the blank interior and matching end, unless
that end already immediately follows. Main-process IPC logs now include a safe
error code and the renderer receives a local-fallback explanation. Typecheck,
lint, format check, and production build pass.

## Verification and current limits

Passed after TexLab:

- `texlab.exe --version` → `texlab 5.26.0`
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`
- `npm run dev` reached `application-ready` and launched the native window.

`npm test` currently fails in existing Windows/Dropbox settings, filesystem-lock,
symlink, and local-TeX fixture tests. The run had no TexLab-specific assertion;
inspect before calling these a TexLab regression.

README still says TeXtra's own license is pending. TexLab is GPL-3.0-only. Do
not publish a bundled release until the owner selects a GPL-compatible TeXtra
license and retains the bundled license/source attribution.

Use `npm run dev`, `npm run typecheck`, `npm run lint`, `npm run format:check`,
`npm test`, `npm run build`, and `npm run test:e2e`. Main must retain argument
arrays, allowlists, path canonicalization, and disabled TeX shell escape.
