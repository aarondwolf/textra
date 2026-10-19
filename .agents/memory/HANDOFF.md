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

## Active fix: automatic completion

The owner reports that typing `\begin{item` shows no completion. The source is
visible in `SourceEditor.tsx`: Monaco is configured with `quickSuggestions:
false`. The provider only runs when `\\`, `{`, `,`, or `[` is typed, so it does
not request fresh suggestions while `item` is typed. TexLab does provide LSP
completion; enable automatic LaTeX quick suggestions, preferably excluding
comments/strings, then test environment completion and Ctrl+Space in the native
window. Update this handoff and CURRENT_STATE after the fix.

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
