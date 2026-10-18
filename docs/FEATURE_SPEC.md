# TeXtra: Master Build Prompt for an Autonomous Coding Agent

You are the lead engineering agent for **TeXtra**, a modern, local-first LaTeX desktop IDE. Your job is to initialize the repository, establish durable agent instructions and project memory, implement the application in carefully sequenced phases, test it rigorously, and continue through the roadmap as far as your environment permits. Do not merely write a plan: **begin implementing immediately after a brief repository inspection and plan**.

This specification is the product source of truth until the human owner changes it. The working product name is TeXtra; make branding easy to rename. The target experience combines the elegance of a modern ChatGPT/Claude desktop interface, the convenience of Overleaf, and the power of VS Code, without requiring a cloud account. It is a real Electron application during development: `npm run dev` must open the native desktop window and support fast React hot module replacement. Production installers are a later phase.

## Operating contract and prompt hygiene

1. Inspect the current repository and environment before changing anything. If the directory contains user work, preserve it. Do not overwrite or delete existing files without inspecting them. Check Node, npm, Git, OS, available TeX distributions, and relevant package-manager commands. If network access is unavailable, record the blocker and implement what can be done offline.
2. Establish a short execution plan with milestones, dependencies, verification commands, and acceptance criteria. Keep the plan in `docs/ROADMAP.md`. Then act. Do not spend the entire run planning or repeatedly asking for permission for routine implementation choices.
3. Work in vertical slices: a functional shell, then real file editing, then actual compilation, then PDF viewing, etc. Prefer the smallest tested implementation that satisfies the feature over an elaborate abstraction. No decorative/inert buttons in the shipped UI. If an action is not implemented, hide it or clearly label it experimental/disabled.
4. Complete phase gates in order. Within a phase, parallelize independent tasks using subagents if the environment supports them. Give subagents bounded ownership of files/modules and explicit interface contracts; do not let two agents edit the same files simultaneously. A coordinating agent integrates, reviews, and runs the full test suite. If subagents are unavailable, proceed sequentially.
5. After each meaningful slice: run formatting, typecheck, lint, relevant unit tests, and an appropriate integration/smoke test; fix failures before building on top. Keep meaningful tests rather than merely snapshotting mock UI. Distinguish passing automated tests from manual tests that cannot be executed in the environment.
6. Maintain small, descriptive Git commits after verified milestones, but never commit secrets or generated build artifacts. Do not amend or force-push existing user history. If Git is unavailable or not initialized, initialize it when safe. Do not push to any remote without explicit authorization.
7. Maintain `AGENTS.md` and the `.agents/memory/` files described below. Before each new task or subagent handoff, read the relevant architecture, decisions, current-state, and known-issues documents. Update these documents after completing work. These files are durable project context, not a place for hidden chain-of-thought; store concise factual decisions, interfaces, status, and reproducible commands.
8. Prefer deterministic parsing and standard tools over LLM calls. AI is optional, user-configurable, budget-aware, and never necessary for basic editing or compilation. Do not send source files, logs, or credentials to external providers without explicit user action and understandable context disclosure.
9. Follow Electron security best practices: context isolation, sandbox where compatible, no Node integration in renderer, restrictive IPC, validated paths and arguments, no arbitrary shell command execution from renderer or model output, and safe handling of untrusted PDFs, TeX files, GitHub repositories, and logs.
10. If an integration depends on platform software or network credentials, implement a clear capability-detection/fallback state and document how to test it. Do not claim an integration is functional solely because a mock passes.
11. Avoid unbounded background agents, infinite loops, or runaway spending. Use bounded test retries, process timeouts, cancellable compilation/AI requests, and explicit stop conditions. Report blockers accurately rather than concealing them.
12. Keep the project runnable at the end of each phase. If time/context runs out, leave a clean checkpoint with exact next steps in `.agents/memory/CURRENT_STATE.md`.

## Product requirements and principles

- Local-first desktop app; source files remain standard `.tex`, `.bib`, images, and folders. No proprietary document lock-in.
- Modern, minimal, responsive UI: collapsible project sidebar, tabs, rounded controls, dark/light themes, resizable panes, command palette, accessible keyboard navigation, and PDF preview.
- Windows is a first-class target; macOS and Linux should be considered in architecture and eventually packaged/tested where environments are available.
- Onboarding detects LaTeX installations, helps install missing distributions, configures compilation, and optionally connects an AI provider. No account required.
- Writing experience remains quiet: AI suggestions, lint warnings, and toolbars should not constantly interrupt prose writing.
- All paths, credentials, build commands, and external operations must be handled safely. Project settings must be exportable without secrets.

## Technology and repository setup

Use Electron + electron-vite + React + TypeScript + Vite, Tailwind CSS, shadcn/ui (or its current supported setup), Monaco editor, PDF.js, Zustand for small UI state, Vitest for unit tests, and Playwright for Electron end-to-end tests if practical. Use ESLint and Prettier. Prefer existing maintained libraries where they genuinely simplify work, but verify APIs and versions from locally installed packages or official documentation; do not invent package exports or rely on stale examples. Keep dependencies modest.

Suggested structure (adapt as justified):

```
textra/
  src/
    main/
      index.ts
      ipc/
      services/
        projects/
        latex/
        diagnostics/
        history/
        ai/
        settings/
    preload/
      index.ts
      types.ts
    renderer/
      index.html
      src/
        App.tsx
        components/
        features/
          editor/
          explorer/
          pdf/
          problems/
          snippets/
          math/
          ai/
          bibliography/
          tables/
          tikz/
          git/
          beamer/
          onboarding/
        state/
        styles/
  tests/
    unit/
    integration/
    e2e/
    fixtures/
  docs/
    ROADMAP.md
    ARCHITECTURE.md
    SECURITY.md
    TESTING.md
    FEATURE_SPEC.md
  .agents/
    memory/
      README.md
      CURRENT_STATE.md
      DECISIONS.md
      ARCHITECTURE.md
      KNOWN_ISSUES.md
      TESTING.md
      PHASE_LOG.md
  AGENTS.md
  README.md
  electron.vite.config.ts
  package.json
  tsconfig.json
  .gitignore
```

Provide npm scripts:
- `npm run dev`: Electron window with renderer HMR and appropriate main/preload restart/reload.
- `npm run build`: production assets, not necessarily installer.
- `npm run dist`: installer/package build once packaging is configured.
- `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run test`, `npm run test:e2e`.

Configure sensible `.gitignore` for node_modules, dist/out, generated PDFs and TeX auxiliaries in designated build directories, local credentials, `.env*` (except an example template), and temporary snapshots. Do not globally ignore user-authored PDFs or `.tex` sources. Include `.env.example` without secrets.

### AGENTS.md: create and maintain this exact kind of content

Create a concise root `AGENTS.md` as the operating guide for every future agent, with these sections:

1. **Mission and priorities:** local-first LaTeX IDE; correctness, data preservation, security, and fast development over flashy demos.
2. **First actions in every session:** read README, ROADMAP, ARCHITECTURE, SECURITY, and `.agents/memory/CURRENT_STATE.md`; inspect Git status; run basic validation; identify the next unfinished phase gate.
3. **Architecture boundaries:** Electron main owns OS/file/process/keychain operations; preload exposes typed narrow APIs; renderer owns presentation/editor interactions; service modules do not import React; AI adapters are replaceable; project files stay portable.
4. **Development commands and verification:** document exact working scripts, required runtimes, and how to run a minimal smoke test.
5. **Coding standards:** strict TypeScript, clear module contracts, typed IPC, no silent `any`, readable components, minimal dependencies, accessibility, safe file writes, and no speculative APIs.
6. **Security rules:** no renderer Node access; no secrets in logs/settings exports; allowlisted installer/build actions; explicit user consent for AI/network operations; do not execute AI-proposed shell commands.
7. **Testing and acceptance:** phase-gate criteria, fixture projects, mock vs real tests, regression testing before commits.
8. **Agent coordination:** bounded tasks, ownership, interface contracts, review/integration responsibility, no simultaneous conflicting edits.
9. **Memory protocol:** which `.agents/memory/` files to read/update, keep summaries factual and short, record decisions and unresolved blockers, do not store credentials or sensitive user content.
10. **Definition of done and reporting:** functionality tested, docs updated, no known critical failures, clean Git status or explained exceptions, next steps recorded.

Memory folder requirements:
- `README.md`: index, update protocol, what belongs in each memory file.
- `CURRENT_STATE.md`: current phase, last passing commit, working features, active task, next three actions, exact verification results.
- `DECISIONS.md`: dated architectural decisions, alternatives, and rationale.
- `ARCHITECTURE.md`: module ownership, IPC contracts, data flows, dependency graph.
- `KNOWN_ISSUES.md`: reproducible issues, severity, workaround, owner/next action.
- `TESTING.md`: OS and tool versions, fixture setup, commands, pass/fail evidence.
- `PHASE_LOG.md`: completed milestones, acceptance evidence, dates/commits.

Do not use agent memory as a substitute for source-controlled documentation. Keep `docs/FEATURE_SPEC.md` detailed and `docs/ROADMAP.md` operational.

### README.md: required content

Create a welcoming and accurate root README containing:
- Project name, one-paragraph purpose, local-first and optional-AI principles.
- Screenshot placeholder clearly labeled as a future screenshot, not fabricated.
- Current implementation status with checked/unchecked features that match reality.
- Prerequisites (supported Node version, npm, optional TeX distribution, optional Git and AI key).
- Quick start: clone/open repository, `npm install`, `npm run dev`.
- Commands for typecheck, lint, tests, build, and packaging (dist only if configured).
- How to open a folder, edit `.tex`, compile, and view PDFs once implemented.
- How TeX distribution detection and setup work on Windows/macOS/Linux.
- AI provider setup, credential handling, estimated cost controls, and offline mode.
- Settings locations, export/import, project configuration, and secret migration behavior.
- Development architecture and key directories.
- Troubleshooting: missing TeX executable, PATH changes, failed build, SyncTeX issues, PDF preview failures.
- Security/privacy statement, contribution/testing instructions, license placeholder marked for owner decision, and roadmap links.

## Phase 0: Foundation and development shell

**Objective:** A reliable Electron development workflow and architecture before advanced features.

Implement:
- Initialize repository safely, package manager, electron-vite React/TypeScript scaffold, Tailwind and accessible modern component system.
- Native desktop window opened by `npm run dev`, hot-reloading UI, main/preload restart behavior, production build script.
- Application shell: top bar, collapsible left project sidebar, center tab/editor area, right PDF pane placeholder, bottom Problems/Output panel, status bar, command palette foundation, dark/light theme, resizable layout.
- Typed IPC bridge with explicit allowed operations; robust error propagation; structured application logging with secret redaction.
- Basic navigation/state persistence and graceful empty/loading/error states.
- Test harness with a smoke test verifying Electron window opens and a representative UI action works. Create fixture LaTeX projects.
- Documentation, AGENTS.md, `.agents/memory/`, roadmap, README, and initial security decisions.

**Gate:** `npm run dev` opens a functional native window; HMR works; `npm run build`, typecheck, lint, and tests pass; app shell is not merely a static screenshot; docs accurately reflect state.

## Phase 1: Functional local LaTeX IDE

**Objective:** A user can open a real folder, write a multi-file document, compile it locally, and inspect the resulting PDF.

Implement:
1. **Project manager and file explorer:** recent/pinned projects, folder switching, recursive file tree, create/rename/delete with confirmation, reveal active file, open in OS file manager, open in VS Code where installed, open individual file in VS Code, context menus, safe relative path handling, external change detection, unsaved-file conflict resolution.
2. **Monaco editor:** LaTeX syntax highlighting, line numbers, bracket matching, folding, multiple tabs, dirty indicators, save/save as, undo/redo, search/replace, word wrap, font settings, auto-close braces, safe file encoding, Ctrl/Cmd shortcuts. Detect project root/main `.tex` document, with manual override and support for `% !TEX root = ...` conventions where practical.
3. **Build service:** discover `pdflatex`, `xelatex`, `lualatex`, `latexmk`, `bibtex`, `biber`, `synctex`; select engine; compile active root document; cancellation/timeouts; captured stdout/stderr; proper cwd; robust Windows path/space handling; build output directory; command templates with editable ordered steps; presets for latexmk, pdfLaTeX, XeLaTeX, LuaLaTeX, and pdfLaTeX→BibTeX→pdfLaTeX×2. Never build commands by unsafe shell interpolation. Preserve main PDF beside `.tex` if configured, while intermediates stay in `build/`; validate platform/tool support rather than promising unsupported flags.
4. **PDF.js viewer:** actual compiled PDF loading, side-by-side preview, zoom, fit-width, page navigation, search, preserved view position on recompilation, errors displayed gracefully. Secure local PDF transport and correct handling of file updates.
5. **SyncTeX:** compile with `-synctex=1`, source→PDF and PDF→source navigation via installed SyncTeX executable, correct coordinate conversions across zoom/scroll, multiple included source files, graceful fallback when unavailable.
6. **Onboarding and distribution management:** first-run detection and test compile, no required account, OS-specific installation options. On Windows offer approved MiKTeX via WinGet (`winget install --id MiKTeX.MiKTeX -e --source winget`, after checking current package metadata) and official TeX Live installer. On macOS detect Homebrew and offer MacTeX, MacTeX-no-GUI, or BasicTeX (`brew install --cask ...`) with installer fallback. On Ubuntu/Debian, Fedora, Arch and other recognized Linux distributions, provide verified package-manager-specific TeX Live install profiles; never assume every distro has the same package names. Show exact commands, expected disk/network impact, elevation requirements, and obtain explicit confirmation before launching; do not run arbitrary copied shell text. Handle admin prompts and PATH refresh; re-detect executables and compile a minimal test document. Offer open distribution manager (MiKTeX Console/TeX Live Manager or OS package manager) when available. Existing distributions are always preferred over installing duplicates. Installation should be cancellable when safely possible and failures explained.
7. **Settings:** local versioned JSON in Electron userData, project overrides in optional `.textra/project.json`, export/import with schema validation and migrations, no secrets in exports, saved layouts, theme, compiler and path preferences. Use OS credential storage for AI keys later; support environment variable references without exporting values.
8. **Basic diagnostics:** real compile output in a bottom panel, errors and warnings linked to source when available; raw log view.

**Gate:** A fixture with multiple `.tex` files, bibliography, table, and figure opens, edits, saves, compiles, previews, and navigates with SyncTeX in an environment with TeX installed. Verify no-data-loss behavior for external edits and failures. If TeX is absent, provide honest skipped integration tests and reproducible manual instructions; do not substitute a fake success.

## Phase 2: Intelligent writing and diagnostics

**Objective:** Make TeXtra distinctly more pleasant than a conventional LaTeX editor without requiring AI.

Implement:
1. **Snippet library:** built-in templates for table/booktabs, figure, equation, align, matrices, cases, itemize/enumerate, theorem/proof, Beamer frame/block/columns/overlays, TikZ; Monaco snippet tab stops/placeholders; searchable palette; custom snippets stored in JSON with trigger, scope, description, body; import/export; wrap selection.
2. **Equation helper:** searchable Greek/operators/relations/arrows/calculus/matrices palette; frequently used/favorite symbols; quick insert for inline/display/equation/align/gather/cases; selection wrapping; optional lightweight equation preview.
3. **TexLab language server:** spawn/connect LSP safely, cross-file document outline, labels/citations/commands completion, jump to definition, references, diagnostics and hover where supported. Verify TexLab licensing and bundling obligations before distributing a binary; if incompatible, use optional external executable detection and document alternatives. Implement graceful no-LSP fallback.
4. **ChkTeX integration:** prefer TexLab integration where reliable, otherwise invoke ChkTeX directly with machine-readable output; lint on save by default, optional debounced live lint; per-rule severity/disable controls; suppress noisy warnings. Optional LaCheck later, not mandatory.
5. **Unified Problems panel:** merge source-tagged TexLab, ChkTeX, and compile diagnostics; severity red/yellow/info/success, file/line/column navigation, filters, raw log, clear build status. Parse standard TeX error patterns robustly, preserve full log, avoid false precision when locations cannot be determined. Each issue offers Search Web, Copy AI Prompt (specific error, nearby source, optional full log), and Ask Built-in AI if configured; concise context default to control token cost. Include a deterministic quick fix only when safe.
6. **AI chat bubble:** resizable floating chat panel; provider adapters for OpenAI, Anthropic, Gemini, compatible endpoints, and optional local endpoints; model selection and configurable defaults; streaming/cancellation; provider-specific key references stored securely. Modes Ask, Generate, Edit. Send selected text/current preamble/explicitly chosen files only with transparent context disclosure. Return temporary snippet cards with Insert at Cursor, Replace Selection, Copy, Discard. Editing proposals must show a diff and require user approval. Avoid sending secrets or full logs by default. Add token/cost estimates and local soft spending limits, with explicit warning that local estimates are not provider-enforced hard caps.
7. **Reference and label intelligence:** navigate `\label`, `\ref`, `\eqref`, `\cite`, detect missing/duplicate labels and missing image paths where feasible, command-aware scanning across included project files, show citation/label suggestions.
8. **Formatting and cleanup:** integrate latexindent if installed, region/document formatting with preview, safe auxiliary-file cleanup, basic package/preamble inspector and missing-package explanations.
9. **Writing tools:** document outline, section navigation, word count excluding commands, table/figure/equation/citation counts, TODO/FIXME listing, quiet focus mode.

**Gate:** Every tool works offline except explicitly AI/web actions; editor insertions respect cursor/selection and undo; diagnostics point to source and are not disruptive; provider tests use mocks and optional real-key smoke tests without exposing keys.

## Phase 3: Advanced research and presentation workflows

**Objective:** Provide specialized tools that are meaningfully better than a generic editor.

Implement:
1. **TikZ sandbox:** separate tab with source editor and compiled cropped PDF preview; preamble modes Document (default, derived from main doc), Basic (TikZ, common libraries, AMS), Custom and saved presets. Temporary standalone wrapper, Compile button, optional debounced auto-compile, error links, Copy Code, Save As, Export PDF, optional SVG via installed conversion tool. Never overwrite project files without confirmation.
2. **Partial TeX quick compile:** detect fragment-only `.tex` files (tables, equations, TikZ), wrap in temporary standalone document; use main-document preamble if available; deterministic package detection (booktabs, graphicx, multirow, tabularx, threeparttable, etc.); compile and show fragment preview; optional AI-assisted diagnosis/package suggestion only after deterministic attempts and explicit user action. Keep temporary files outside source directories.
3. **Editable table inspector:** parse tabular-like environments with a LaTeX-aware parser, not naive regex; show grid of cells, rows, columns, headers, notes; safe edits and source round-trip for supported constructs; read-only fallback for complex macros/multicolumn/math; preview original vs edited; regression-table conveniences for esttab, modelsummary, stargazer, booktabs, threeparttable, scaling, column visibility, notes, Beamer highlights. Preserve numerical values and formatting unless explicitly changed.
4. **BibTeX browser:** parse `.bib` files into editable/sortable/filterable table with selectable columns (key, authors, title, year, journal, etc.); preserve original entries and comments as much as possible; detail editor; count citations in `.tex` files with command-aware parsing (multiple keys, optional args, comments); sort by usage; unused/duplicate/missing citation reports; autocomplete keys.
5. **Git integration:** Git status, diff, stage/unstage, commits, branches, history, conflict indicators; avoid hidden modifications to user's working tree. Auto-history independent of normal Git: snapshots on configurable interval only after changes, before major AI edits, retention/cleanup policy, source files by default, exclude large binaries/build outputs. Prefer dedicated app-managed snapshot storage or separate Git repository over modifying user's branch/index; restore/compare single files; robust handling of untracked projects.
6. **Inline AI completion:** Monaco inline completion provider with configurable adapters (general provider APIs, FIM-capable models where available, local Ollama or compatible endpoints); default Smart mode only in LaTeX commands/math/structured contexts, Manual mode shortcut, optional Always mode. Debounce, cancel stale requests, small prefix/suffix context, caching, no requests during rapid navigation, max output, per-minute rate limit, monthly estimated spending cap, visible usage dashboard. Never assume GitHub Copilot provides a supported general-purpose API. Do not transmit entire documents by default.
7. **Beamer mode:** slide-oriented PDF preview with thumbnails, navigate frame environments, overlay count and states, shortcuts for only/uncover/onslide/alert, overlay comparison and presentation mode; compile actual overlays rather than faking results.
8. **Custom lint rules:** configurable checks for hardcoded references, TODOs, unreferenced labels, missing graphics, duplicate labels, package hints; no noisy duplication of TexLab diagnostics.

**Gate:** TikZ and fragment builds produce real PDFs; table edits preserve round-trip correctness on supported fixtures; Git and history never alter unrelated work; citation counts verified on edge cases; AI completion respects budget and disabled state.

## Phase 4: Polish, portability, and distribution

**Objective:** A stable app others can install and use confidently.

Implement:
1. **GitHub Beamer theme importer:** accept repository URL, inspect file tree for `beamertheme*.sty`, `beamercolortheme*.sty`, `beamerfonttheme*.sty`, `beamerinnertheme*.sty`, `beameroutertheme*.sty`; identify related assets and dependencies, show preview/list and license/source, select destination, import only user-approved files. Support public repositories first; no executing repository scripts; private auth optional later.
2. **Project templates:** paper, dissertation, Beamer, CV, letter, blank; create from local templates or trusted GitHub archives; turn project into template with sensible exclusions.
3. **Polish:** accessibility and keyboard navigation, responsive panes, customizable toolbars/shortcuts, drag-and-drop, file context menus, UI density, persistent layouts, robust error/empty states, performance for large projects, virtualized file lists, improved startup speed.
4. **Migration:** export/import settings with schema version, provider references but no keys, project settings, snippet libraries, themes, presets; post-import report showing missing executables, paths and credentials to reconnect.
5. **Packaging:** electron-builder or equivalent; Windows installer first, macOS/Linux where build environments allow; signed binaries only if credentials are provided; do not fabricate signing; reproducible build instructions, optional updates only with trusted configured release infrastructure.
6. **Security and reliability review:** review IPC, path traversal, symlinks, untrusted PDF/repository handling, external URL opening, build command injection, credential redaction, prompt-injection risks in documents/logs, file restoration, atomic writes, backups, and offline behavior. Ensure source files and user Git history survive failures.
7. **Docs:** polished README, user guide, onboarding troubleshooting, contributor guide, architecture diagrams, security policy, test matrix, release checklist and honest known limitations.

**Gate:** All automated checks pass; Windows install/uninstall and representative project workflow tested on a real Windows environment where available; no critical data-loss/security bugs; cross-platform gaps documented explicitly; README reflects actual implementation.

## Cross-cutting implementation requirements

### IPC and filesystem

Use a typed preload API, not direct renderer access to Node or the shell. Validate arguments in the main process. Normalize/canonicalize paths, guard against traversal, confirm destructive operations, and use atomic writes for settings and documents when possible. Watch files for external changes and avoid overwriting unsaved edits. Expose progress/cancellation for long-running operations. Open external URLs only after validation.

### Compilation and process execution

Prefer `spawn` with executable and argument arrays rather than shell interpolation. Resolve project roots and build outputs explicitly; handle spaces, Unicode paths, Windows executable extensions, and PATH refresh. Avoid overlapping builds of the same target; cancel stale work. Capture structured logs without leaking sensitive environment variables. Support user-defined pipelines through validated commands and explicit confirmation, not arbitrary code execution silently. LaTeX documents themselves can invoke powerful shell behavior: disable shell escape by default and warn before enabling it.

### AI boundaries

Separate chat, snippet generation, patch proposals, and inline completion adapters. Use provider-agnostic interfaces and per-provider capability flags. Never hardcode a provider/model that may be unavailable; choose supported inexpensive models from a configurable catalog and allow manual override. Respect rate limits and retries with backoff. Explicitly show which source content will leave the machine. Never send secrets, `.env`, credential files, or unrelated project directories. Treat AI output as untrusted and require approval for file changes. Provide full offline functionality without any API key.

### UI/UX

Aim for a restrained, modern design inspired by ChatGPT/Claude and Overleaf, not a clone. Sidebars, tabs, rounded buttons, resizable editor/PDF split, unobtrusive status bar, floating AI bubble, command palette, and discoverable keyboard shortcuts. Use clear loading/disabled/error states, accessible focus management, tooltips, and dark/light themes. Avoid persistent alerts for benign lint warnings.

### Tests and fixtures

Build representative fixtures: minimal article; multi-file dissertation with bibliography; Beamer overlays; TikZ graphic; simple and complex regression tables; missing package; malformed TeX; duplicate/missing labels; BibTeX with multiple citations/comments; Unicode paths; paths with spaces; external file modifications; failed/cancelled build; mock AI provider responses; Git repo with uncommitted changes. Use unit tests for parsers and path/security logic, integration tests for services, Electron e2e for critical workflows, and real TeX smoke tests when available. Mark skipped tests and why. Never replace a failed real integration with a passing fake test and call the feature complete.

## Execution order for this run

1. Inspect repository, OS/toolchain, Git status and existing user files; summarize findings briefly.
2. Write `AGENTS.md`, `.agents/memory/` structure, `docs/FEATURE_SPEC.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/TESTING.md`, and README with the above requirements. Ensure README distinguishes planned from implemented features.
3. Scaffold electron-vite + React + TypeScript and configure scripts, styling, UI primitives, strict types, typed IPC, lint/format/test infrastructure.
4. Implement Phase 0 shell with real panel state, navigation, theme, command palette foundation, and smoke tests. Run checks, fix issues, and commit.
5. Continue into Phase 1 in vertical slices: file explorer and editing; real build runner; PDF.js; SyncTeX; onboarding/distribution detection; settings; diagnostics. Test and commit after each slice.
6. When Phase 1 passes, continue Phase 2, then Phase 3, then Phase 4 as time/resources permit. Re-evaluate dependencies and risk before each phase, but do not stop merely to ask permission for normal engineering decisions.
7. If a feature is blocked by missing external software, credentials, licensing, or OS access, build the correct integration seam, add tests for what can be verified, document the blocker, and continue independent tasks. Do not falsely mark blocked work complete.
8. At the end of each phase and at final handoff, report: features implemented, tests run and results, known limitations, commits, next steps, and the exact command to launch the app. Update agent memory first.

## Final definition of done

The project must remain a genuine, runnable, maintainable Electron application. `npm run dev` is the primary iteration loop. No cloud account is required. Source files are standard LaTeX. Core editing and compilation work without AI. All advertised actions are functional or clearly disabled. Data-loss risks are addressed. Tests and documentation describe reality. The agent leaves an explicit, reproducible handoff.

**Now begin. Inspect the environment and repository, create the foundational documentation and memory, scaffold the app, implement Phase 0, run tests, and proceed through the remaining phases autonomously according to the gates above. Do not stop after writing the plan.**
