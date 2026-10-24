# Current state

2026-10-24 Architectural Modernization & Codebase Audit Implementations:

- AsyncMutex Consolidation (F-13):
  - Created [src/main/services/mutex.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/mutex.ts) exporting `AsyncMutex` providing sequential FIFO execution (`run`) and barrier synchronization (`flush`).
  - Unified promise mutexes across [src/main/services/projects.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/projects.ts), [src/main/services/history.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/history.ts), [src/main/services/preferences.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/preferences.ts), [src/main/services/settings.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/settings.ts), and [src/main/services/ai-chats.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/ai-chats.ts).
  - Added unit test in [tests/unit/mutex.test.ts](file:///c:/Users/aaron/Dropbox/repos/textra/tests/unit/mutex.test.ts).
- Clean Process Tree Termination Consolidation (F-14):
  - In [src/main/services/latex.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/latex.ts), eliminated hand-rolled process killer and shared `terminateProcessTree` from [src/main/services/owned-process.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/owned-process.ts).
  - Cleanly terminates child processes and compiler process trees across Windows and POSIX without leaking background processes. Verified with real LaTeX process cancellation and timeout integration tests.
- Strongly Typed In-Renderer Event Bus (F-09):
  - Created [src/renderer/src/services/events.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/services/events.ts) with typed event registry `TextraEvents`, `emitTextraEvent`, and `onTextraEvent`.
  - Replaced untyped `window.dispatchEvent` calls across [src/renderer/src/App.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/App.tsx) and [src/renderer/src/Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx).
  - Added unit test in [tests/unit/events.test.ts](file:///c:/Users/aaron/Dropbox/repos/textra/tests/unit/events.test.ts).
- Myers Line Diffing Engine in AI Edits (F-05):
  - In [src/shared/ai-edits.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/shared/ai-edits.ts), replaced the custom quadratic matrix table with Myers line diffing via `diff` (`diffLines`), with prefix/suffix line trimming and bounds protection.
  - Added unit test in [tests/unit/ai-edits.test.ts](file:///c:/Users/aaron/Dropbox/repos/textra/tests/unit/ai-edits.test.ts).
- BibTeX Nested Braces & Date Fallback (F-02):
  - In [src/shared/bibliography.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/shared/bibliography.ts), replaced fragile single-character regex with a balanced brace extractor supporting nested braces, unquoted values, and BibLaTeX `date` fallback.
  - Added test coverage in [tests/unit/bibliography.test.ts](file:///c:/Users/aaron/Dropbox/repos/textra/tests/unit/bibliography.test.ts).
- Cross-Platform Executable Resolution via `which` (F-14):
  - Adopted `which` across [src/main/services/texlab-manager.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/texlab-manager.ts), [src/main/services/latex.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/latex.ts), [src/main/services/language.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/language.ts), and [src/main/services/ai-service.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/ai-service.ts).
  - Respects Windows `PATHEXT` and POSIX `X_OK` binaries without hand-rolled delimiter loops.
- TeX Diagnostics Deduplication (F-15):
  - In [src/main/services/diagnostics.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/diagnostics.ts), replaced `O(N^2)` `findIndex(JSON.stringify)` deduplication with `O(N)` deterministic key set deduplication.
- Safe LaTeX Section Movement (F-01):
  - In [src/shared/writing-analysis.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/shared/writing-analysis.ts), ensured moving sections never appends content past \end{document}.
- Centralized Transient Retry Helper for Atomic Writes (F-10):
  - Created [src/main/services/retry.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/retry.ts) exporting `retryTransient`.
  - Applied consistently across [src/main/services/projects.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/projects.ts) (`saveFile` and `writeRecent`), [src/main/services/history-storage.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/history-storage.ts), [src/main/services/settings.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/settings.ts), [src/main/services/ai-service.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/ai-service.ts), [src/main/services/preferences.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/preferences.ts), and [src/main/services/ai-chats.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/ai-chats.ts).
  - Added unit test in [tests/unit/retry.test.ts](file:///c:/Users/aaron/Dropbox/repos/textra/tests/unit/retry.test.ts).
- Zod Validation Adoption (F-08):
  - Defined reusable Zod schemas in [src/shared/recipes.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/shared/recipes.ts) and [src/main/services/settings.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/settings.ts) for recipe and project config validation.
- Accessible Splitters & DropdownMenu Keyboard Navigation (F-12):
  - In [src/renderer/src/components/DropdownMenu.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/components/DropdownMenu.tsx) and [styles.css](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/styles.css), implemented full keyboard navigation (`ArrowDown`, `ArrowUp`, `Home`, `End`, `Enter`, `Space`, `Escape`, `Tab`), roving tabIndex / `aria-activedescendant`, and auto-scroll into view.
  - In [src/renderer/src/features/writing/WritingPanel.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/writing/WritingPanel.tsx), [src/renderer/src/features/history/HistoryPanel.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/history/HistoryPanel.tsx), and [writing.css](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/writing/writing.css), added WCAG `role="separator"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, arrow key resize handling, and `:focus-visible` highlights.
- Verification:
  - `npm run typecheck` passed (0 errors).
  - `npm run lint` passed (0 errors, 0 warnings).
  - `npm test` passed (all 70 test files, 715/715 tests passed).

2026-10-24 Electron audit milestone (branch codex/electron-architecture, base 81298e0):

- Implemented the user-approved comprehensive architecture plan. Findings and source
  map: docs/ELECTRON_AUDIT.md. One profile owner, explicit workspace/close lifecycle,
  secure portable history/reviewed legacy recovery, versioned Monaco buffers and
  save queues, bounded/cancellable language processes, watcher and TexLab ownership.
- Integration fixes include late AI/build admission guards, current dirty state on
  close, flush-before-project-switch, local-restore watcher acknowledgement, immediate
  settings export/import persistence, and removal of duplicate keyboard dispatch.
- Final unit/integration gate: 704/704 in 67 files (67.95s). Full serial Windows native
  gate: 15 passed, 2 deliberate skips (4.1m); the skipped startup benchmark then passed
  separately (three warm launches, 24.5s). No live provider calls or real profile used.
  Typecheck, lint, production build and HMR/preload/main restart smoke passed.
- Warm-profile editor observation median 2.133s (1.879-2.666s); main timer-delay p95
  9.57-10.67ms, maximum 16.81ms. These are diagnostic samples, not a controlled speedup
  or a cold packaged launch. See docs/PERFORMANCE.md for methodology and limits.
- Next unfinished gate remains Phase 1 cross-platform verification; Phase 2/platform
  matrix and release gates remain open. No critical unresolved audit defect identified.
- Next three actions: profile packaged warm/cold startup/first paint; run macOS/Linux
  editor/compile/PDF/SyncTeX plus remaining TeX-engine matrix; implement and verify
  installer, upgrade/uninstall and credential migration release checks.
- Launch: npm run dev. Tests/probes restored; generated fixtures are ignored. The
  local audit milestone commit records this verified tree; no push is authorized.

2026-10-23 Code Quality Audit Priority 1 & 2 Optimizations & Bug Fixes:

- Hot-Loop File I/O Short-Circuit in ExternalEditorService:
  - In [src/main/services/external-editor.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/external-editor.ts), updated `signature(ref: FileRef, cached?: Signature | null)`.
  - Performs `stat(target)` first: if `cached` signature exists and `info.size === cached.size && info.mtimeMs === cached.mtimeMs`, returns `cached` immediately without reading the file.
  - Eliminates the previous 750ms polling loop spike that performed full-file disk reads, UTF-8 decodes, and SHA-256 hashes on every watched file even when idle.
  - Added unit test in [tests/unit/external-editor.test.ts](file:///c:/Users/aaron/Dropbox/repos/textra/tests/unit/external-editor.test.ts) verifying `projects.readFile` is called on watch initialization and not re-invoked on subsequent polling ticks when file metadata is unchanged.
- Preference Persistence Debounce in UI State:
  - In [src/renderer/src/state/ui.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/state/ui.ts), debounced `savePreferences()` by 250ms (`SAVE_DEBOUNCE_MS`) when `updatePreferences()` is invoked.
  - Dragging split pane dividers (sidebar, assistant, preview) now mutates in-memory state smoothly without firing continuous 60–240Hz IPC atomic writes and disk `fsync()` calls.
  - `preferencesSaved()` cancels the debounce timer and flushes any pending preferences immediately before dialog closures, and a `beforeunload` listener flushes pending preferences on window exit.
  - Added unit test in [tests/unit/ui-store.test.ts](file:///c:/Users/aaron/Dropbox/repos/textra/tests/unit/ui-store.test.ts) verifying rapid updates are coalesced into a single persist call and flushed by `preferencesSaved()`.
- Non-Blocking Window Close Dialog:
  - In [src/main/index.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/index.ts), replaced blocking `dialog.showMessageBoxSync(window, ...)` with asynchronous `await dialog.showMessageBox(window, ...)`.
  - Prevents freezing the entire Electron main process event loop, IPC routing, file watchers, and child processes while waiting for user confirmation on dirty workspace close.
- Reduced Buffer Allocation in ConfigService:
  - In [src/main/services/settings.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/settings.ts), changed `Buffer.alloc(MAX_SETTINGS_BYTES + 1)` (1 MiB allocation) to `Buffer.alloc(info.size + 1)` in `ConfigService.read()`, avoiding large zeroed buffer allocations on every settings read.
- Local Completion LaTeX Parsing Deduplication:
  - In [src/renderer/src/features/editor/SourceEditor.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/editor/SourceEditor.tsx), restructured `localCompletion` so it evaluates `isCitation` first.
  - Only scans for citations when `isCitation` is true, and only scans for labels when `isCitation` is false, eliminating redundant double-parses (`analyzeLatexDocument`) of every open document on every keystroke completion trigger.
- Accessible Custom Trigger in DropdownMenu:
  - In [src/renderer/src/components/DropdownMenu.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/components/DropdownMenu.tsx), added `role="button"`, `tabIndex={disabled || items.length === 0 ? -1 : 0}`, `aria-haspopup="menu"`, `aria-expanded={open}`, `aria-label={ariaLabel}`, and Enter/Space keyboard activation to custom trigger wrappers.
- LaTeX-Aware Status Bar Word Count:
  - In [src/renderer/src/features/editor/SourceEditor.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/editor/SourceEditor.tsx), updated status bar word count for `.tex` files to use `analyzeLatexDocument(doc.content).counts.words`, aligning with the Writing panel and ignoring preamble macros, comments, and commands.
- Verification:
  - `npm run typecheck` passed (0 errors).
  - `npm run lint` passed (0 errors, 0 warnings).
  - `npm run format:check` passed (all files match Prettier style).
  - `npm test` passed (56/56 test files, 608/608 tests).
  - `npm run build` passed (production build succeeded in 8.35s).

2026-10-23 AI Provider Default Model Dropdown Styling & Editor File Switching Latency Resolution:

- AI Provider Connection Default Model Dropdown:
  - Resolved CSS specificity conflict in [ai-settings.css](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/chat/ai-settings.css): Updated `.ai-settings-dialog button` to exclude `.dropdown-menu-item`, `.dropdown-menu-trigger`, and `.dropdown-menu-popup button`.
  - Added explicit styles for `.ai-settings-dialog .dropdown-menu-trigger` and `.ai-settings-dialog .dropdown-menu-item`: items are transparent by default (even when selected), highlighting only on `:hover` and `:focus-visible`, with text left-aligned.
  - In [styles.css](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/styles.css), set `align-self: flex-start` on `.dropdown-menu-container` and `align-self: stretch` on `.dropdown-menu-container.full-width` so non-full-width dropdowns inside flex column containers (such as `.field-label`) do not stretch full width, but size to the width of the widest item via the sizer.
  - In [AIProviderEditor.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/chat/AIProviderEditor.tsx), surfaced `description: model.label !== model.id ? model.id : undefined` in the catalog options matching [ModelPicker.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/chat/ModelPicker.tsx).
- Diagnosed & Fixed Editor File Switching Latency (~500ms -> Instantaneous):
  - Root Cause Diagnosis:
    1. In [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx), `openExplorerFile` was calling `closeDocument(previous.path)` synchronously before `openDocument(path)` resolved.
    2. When a preview tab was the sole open tab, `closeDocument` immediately cleared `documents` (`[]`) and set `activePath: null`.
    3. As a result, `active` in `Workspace` evaluated to `undefined`, causing the Welcome screen to flash and `<SourceEditor>` to unmount.
    4. Unmounting `<SourceEditor>` invoked its cleanup effect, disposing the entire Monaco editor instance, all models, and view states.
    5. Once `window.textra.readFile` completed across IPC, `<SourceEditor>` remounted and re-created the entire Monaco editor from scratch, taking 300–500ms.
    6. Additionally, `projects.snapshot` in [src/main/services/projects.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/projects.ts) allocated a 5.24MB (`MAX_TEXT_BYTES + 1`) zeroed buffer on every single file read.
  - Fix Implementation:
    1. In [src/renderer/src/state/workspace.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/state/workspace.ts), extended `openDocument` with `replacePath?: string`. Replaces the candidate document atomically in the same single state update where the new document is added and activated.
    2. In [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx), `openExplorerFile` no longer closes the previous document in advance. Instead, it passes `replacePath: shouldReplace ? previous.path : undefined` directly to `openDocument`.
    3. The previous document remains mounted in `<SourceEditor>` during the read, preventing any unmount or Monaco teardown. Once the new file is read, Monaco simply swaps its model (`instance.setModel`) in < 1ms.
    4. In [src/main/services/projects.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/projects.ts), optimized `snapshot` buffer allocation to `Math.min(Math.max(info.size + 1024, 4096), MAX_TEXT_BYTES + 1)`, avoiding multi-megabyte allocations for small files.
    5. Added 2 unit tests in [tests/unit/workspace-state.test.ts](file:///c:/Users/aaron/Dropbox/repos/textra/tests/unit/workspace-state.test.ts) testing atomic preview replacement and dirty document preservation.
- Verification:
  - `npm run typecheck` passed (0 errors).
  - `npm run lint` passed (0 errors, 0 warnings).
  - `npm run format:check` passed (all files match Prettier style).
  - `npm test` passed (56/56 suites, 606/606 tests).
  - `npm run build` passed (production build succeeded in 8.55s).

- Official VS Code Logo:
  - In [icons.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/icons.tsx), upgraded `VSCodeIcon` to the official Microsoft Visual Studio Code vector graphic, including accurate multi-layered ribbon geometry and authentic brand colors (`#0065A9`, `#007ACC`, `#1F9CF0`), drop shadows, and overlay gradient.
  - Dynamically scoped mask, filter, and gradient IDs using React's `useId()` to ensure zero ID collisions when multiple icons render simultaneously.
  - Retained clean greyed-out visual (`filter: grayscale(1); opacity: 0.5`) in [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx) when VS Code is not installed on the host system.
- DropdownMenu Hover Highlight & Width Sizing:
  - Solved CSS specificity conflict in [setup.css](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/onboarding/setup.css): Excluded `.dropdown-menu-item`, `.dropdown-menu-trigger`, and `.dropdown-menu-popup button` from `.setup-dialog button` default styling.
  - Ensured menu items in [DropdownMenu.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/components/DropdownMenu.tsx) and [styles.css](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/styles.css) are transparent by default (even when selected), highlighting only on `:hover` and `:focus-visible`.
  - Added intrinsic hidden sizer in [DropdownMenu.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/components/DropdownMenu.tsx) (`.dropdown-menu-sizer`) measuring all item labels, descriptions, and icon/caret spacing so the dropdown trigger and popup menu automatically size to the exact width of the widest item instead of stretching full-width.
  - Set default `fullWidth = false` on `DropdownMenuProps`.
- AI Models Dropdown Single-Line Display:
  - Updated [ModelPicker.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/chat/ModelPicker.tsx) and [model-picker.css](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/chat/model-picker.css):
    - Removed API endpoint URL from the display and title tooltip.
    - Laid out model name and provider on a single horizontal line (`flex-direction: row; align-items: baseline; gap: 6px;`) with a standard button height of 28px.
    - Preserved text formatting differences: primary font weight/color for the model name, and muted `<small>` styling for the provider name.
- Transient Windows Filesystem Lock Resilience:
  - Added `retryTransient` with exponential backoff to `AIService.write` in [src/main/services/ai-service.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/ai-service.ts) to eliminate Windows file indexer and Dropbox sync race conditions during atomic `ai.json` renames.
- Verification:
  - `npm run typecheck` passed (0 errors).
  - `npm run lint` passed (0 errors, 0 warnings).
  - `npm run format:check` passed (all files match Prettier style).
  - `npm test` passed (56/56 test files, 604/604 tests).
  - `npm run build` passed (production build succeeded in 8.36s).

2026-10-23 latexindent Log Redirection, Writing Outline Section Reordering, Taskbar Icon, Settings Icons & VS Code Status:

- latexindent Log Destination Redirection:
  - Updated `LanguageService` constructor in [src/main/services/language.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/language.ts) to accept `getBuildDirectory?: (projectId: string, path: string) => Promise<string>`.
  - In `format()`, computed `fileBase = basename(resolved, extname(resolved))` and `logFileName = `${fileBase}-indent.log``.
  - Resolved `cruftDir` from project recipe configuration via `getBuildDirectory` or fallback `join(root, 'build', 'textra')`, ensuring directory creation with `mkdir(cruftDir, { recursive: true })`.
  - Passed `['-c', cruftDir, '-g', logFileName, '-']` to `latexindent`, ensuring no `indent.log` or cruft files are written into the document directory.
  - Wired in [src/main/index.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/index.ts) using project config and active recipe build directory resolution. Auxiliary file cleanup in `index.ts` already purges `<fileBase>-indent.log`.
- Writing Outline Section Drag-and-Drop & Reordering:
  - Added outline range and movement helpers in [src/shared/writing-analysis.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/shared/writing-analysis.ts):
    - `computeOutlineSectionRange(outline, index, totalLines, lines)`: computes 0-based `[startLine, endLine]` for a section and its descendants until the next section of equal/higher hierarchy, `\end{document}`, or EOF.
    - `moveSectionInLatex(source, fromIndex, toIndex, position, outline)`: extracts section block, inserts before/after destination, detects/rejects invalid moves into descendant child sections, and preserves exact CRLF/LF line endings.
  - Added 5 unit tests in [tests/unit/writing-analysis.test.ts](file:///c:/Users/aaron/Dropbox/repos/textra/tests/unit/writing-analysis.test.ts) covering moving before, moving after, nested subsection preservation, sibling subsection movement, child move prevention, and CRLF preservation.
  - Updated [WritingPanel.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/writing/WritingPanel.tsx) with HTML5 drag-and-drop (`draggable`, `onDragStart`, `onDragOver`, `onDragLeave`, `onDrop`, `onDragEnd`) with visual guide lines (`drop-before`, `drop-after`), plus accessible Move Up and Move Down chevron buttons.
  - Updated [writing.css](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/writing/writing.css) for action buttons and drop insertion indicators.
  - Added `textra:apply-document-content` listener in [SourceEditor.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/editor/SourceEditor.tsx) using Monaco `instance.executeEdits(...)` bracketed by `pushUndoStop()` for single-step Ctrl+Z undo/redo.
  - Wired in [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx) to execute section moves seamlessly.
- Taskbar Squircle Icon Padding & Scaling:
  - Adjusted scale transform in [resources/icons/textra-logo-template.svg](file:///c:/Users/aaron/Dropbox/repos/textra/resources/icons/textra-logo-template.svg) from `scale(0.84)` (padding 81.92px) to `scale(0.91)` (padding 46.08px), enlarging the inner logo mark ~8.3% inside the squircle boundary.
  - Regenerated all 6 icon variants (light, dark, light-squircle, dark-squircle, safe-white, safe-dark) across SVG, PNG, and ICO presets via `npm run generate:icons`, and updated `resources/icon.ico`, `resources/icon.png`, `resources/icon.svg`.
- Settings Navigation Icons:
  - In [SetupDialog.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/onboarding/SetupDialog.tsx), replaced the repeated `Article` icon across Editor, Files, and Shortcuts with distinct icons:
    - Editor: `Code` icon
    - Files: `Files` icon
    - Shortcuts: `Keyboard` icon (imported from `@phosphor-icons/react` via [icons.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/icons.tsx))
- Files Tab VS Code Icon & Detection:
  - Added official VS Code ribbon SVG icon `VSCodeIcon` to [icons.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/icons.tsx).
  - In [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx), checked `vscodeAvailable = tools.some(tool => tool.name === 'vscode' && Boolean(tool.path))`.
  - Replaced the generic code icon with `<VSCodeIcon size={14} />` in the Files panel header and context menu, applying disabled styling (`opacity: 0.5; pointer-events: none`) and explanatory tooltip ("Visual Studio Code not detected on system") when VS Code is not installed.
- Verification:
  - 56/56 test files and 604/604 tests pass (`npm test`).
  - `npm run typecheck` passes with zero errors.
  - `npm run lint` passes with zero errors and warnings.
  - `npm run format:check` passes with all files formatted.
  - `npm run build` passes with zero errors.

2026-10-23 UI Polish, Settings State Isolation, Hysteresis, Auto-Close Diffs & Button Sizing:

- Settings latexindent Connection & Tool Lifecycle:
  - Settings Tool Detection: Added `void refreshTools()` to the `open` effect in [SetupDialog.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/onboarding/SetupDialog.tsx) so opening Settings always scans for installed tools immediately, ensuring latexindent and other compiler tools reflect real system PATH and configured paths.
  - Formatter Custom Path Support: Updated `findLanguageTool` in [language.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/language.ts) to check `getToolPath(canonicalName)` first, ensuring custom executable overrides set in Settings for `latexindent` or `chktex` are properly respected by the formatter and linter.
  - Action Clarification: Updated the Document formatting section in `SetupDialog.tsx` to provide a "Check latexindent" verification action when available and "Install latexindent" link when missing.
- Settings Status Message State Isolation:
  - Added `useEffect(() => { setMessage(null); setLog(''); }, [section, open])` in [SetupDialog.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/onboarding/SetupDialog.tsx) ensuring transient actions (such as "Cleanup cancelled or the TeXtra build folder was already empty.") and compiler test output do not persist across different settings sections or dialog reopenings.
- Preview Tab Overflow Hysteresis:
  - Implemented directional hysteresis buffers in `measure()` in [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx) for `.preview-tabs-host` mode switching:
    - `full` to `icons` collapses at `< 250px` (or `< 310px` with Markdown), but requires `>= 280px` (`340px`) to expand back to `full`.
    - `icons` to `menu` collapses at `< 125px` (or `< 155px` with Markdown), but requires `>= 155px` (`185px`) to expand back to `icons`.
    - The 30px hysteresis buffer eliminates tab layout oscillation and rapid flickering when resizing the preview pane.
- Auto-Close Preview Pane on Diffs:
  - In [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx), added an automatic effect and explicit triggers in `compareHistorySnapshot` and `refreshConflictComparison` to automatically close the preview pane (`updatePreferences({ previewVisible: false })`) when a history diff or conflict diff is displayed, allowing diffs to occupy the full available width.
- AI Chat Privacy Notice Banner:
  - Redesigned `.ai-chat-privacy` in [styles.css](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/styles.css):
    - Made the container a crisp rectangle (`border-radius: 0`).
    - Added mixed-in accent tint background (`color-mix(in srgb, var(--accent) 9%, var(--surface))`), subtle tinted border, and a 3px accent left callout edge.
    - Expanded right padding (`padding: 10px 38px 10px 14px`) and nestled the dismiss button (`top: 5px; right: 5px; width: 20px; height: 20px; border-radius: 0`) to keep the X icon cleanly separated from the banner text.
- IDE-Wide Button Sizing Hierarchy:
  - Standard Action Buttons: Unified all regular buttons in Settings (`.setup-dialog button:not(.icon-button)`), AI settings (`.ai-settings-dialog button`), and dialogs (`.dialog-actions > button`) to a standard height of 28px, 12px font size, 500 font weight, `0 12px` padding, and `var(--radius-pill)` border radius.
  - Primary Action Buttons: Styled `.primary-button` with accent background, contrast text, and prominent weight.
  - Danger Buttons: Styled `.danger-button` with alert-error hue and hover tinting.
  - Icon Buttons: Retained standard 24x24px small and 28x28px regular icon button sizing.

2026-10-23 Long-term Settings & Storage Architecture (AppData vs .textra):

- Settings & AppData Storage Architecture:
  - Resolved packaged Electron application storage: Replaced `join(testUserData ?? app.getAppPath(), '.textra-local')` with `join(app.getPath('userData'), 'ai')` in [src/main/index.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/index.ts), preventing runtime failure inside read-only `resources/app.asar` when packaged.
  - Automatic Development Migration: Added startup migration in `index.ts` so in development, any existing `.textra-local/ai.json` is safely copied to `%APPDATA%\TeXtra\ai\ai.json` if the target does not yet exist.
  - History Snapshots Storage Routing:
    - Updated [HistoryService](file:///c:/Users/aaron/Dropbox/repos/textra/src/main/services/history.ts) to accept `userDataDir`.
    - If a project already has a `.textra/history` directory, snapshots remain local for backward compatibility.
    - If `.textra/history` does not exist, snapshots and `index.json` are placed under `%APPDATA%\TeXtra\history\<projectId>`, preventing user LaTeX repositories from accumulating ephemeral `.gz` snapshot files.
  - Native AppData Inspection:
    - Added `textra:appdata:open` IPC handler in `src/main/index.ts` invoking `shell.openPath(app.getPath('userData'))`.
    - Added `openUserDataFolder(): Promise<Result<void>>` to `TextraAPI` in [src/shared/api.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/shared/api.ts) and exposed via [src/preload/index.ts](file:///c:/Users/aaron/Dropbox/repos/textra/src/preload/index.ts).
    - Added "Application data (AppData)" section in the Import & export tab in [SetupDialog.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/onboarding/SetupDialog.tsx) with an "Open AppData folder" button.
    - Added "Open application data folder (AppData)" to the Command Palette in [App.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/App.tsx).
- Verification: 56/56 test files and 599/599 tests pass. `npm run typecheck`, `npm run lint`, and `npm run format:check` pass with zero errors.

2026-10-23 Dropdown/Pullup Audit & Mirrored Titlebar Panel Icons:

- Mirrored Titlebar Panel Icons:
  - Fixed panel toggle icon orientations in [icons.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/icons.tsx):
    - `PanelLeft`: Window box with left divider line (`x=9`).
    - `PanelLeftClose`: Left divider line with leftward collapse arrow (`m16 15-3-3 3-3`).
    - `PanelLeftOpen`: Left divider line with rightward expand arrow (`m14 9 3 3-3 3`).
    - `PanelRight`: Window box with right divider line (`x=15`), the exact horizontal reflection of `PanelLeft`.
    - `PanelRightClose`: Right divider line with rightward collapse arrow (`m8 9 3 3-3 3`), the exact horizontal reflection of `PanelLeftClose`.
    - `PanelRightOpen`: Right divider line with leftward expand arrow (`m10 15-3-3 3-3`), the exact horizontal reflection of `PanelLeftOpen`.
  - Updated title bar action buttons in [App.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/App.tsx) and [styles.css](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/styles.css) with `aria-pressed` and `.active` state styling.
- Comprehensive Dropdown / Pullup Component Audit:
  - Audited all popup, pullup, and dropdown menus across the codebase and migrated custom implementations to `<DropdownMenu>`:
    - [FormattingToolbar.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/editor/FormattingToolbar.tsx): Converted Heading dropdown to `<DropdownMenu preventFocusSteal={true}>`, removing redundant timeout refs and blur handlers while preserving Monaco editor text selection on mousedown.
    - [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx): Converted Tab Overflow menu (`documents.length > 2`) to `<DropdownMenu>`, removing custom click-outside and open state management.
    - [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx): Converted Preview Views menu (`tabMode === 'menu'`) to `<DropdownMenu footer={...}>`, removing custom dismiss listeners and leveraging unified popup styling.
  - Enhanced [DropdownMenu.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/components/DropdownMenu.tsx) to support:
    - `preventFocusSteal?: boolean`: Prevents focus loss from Monaco editor when clicking triggers or menu items.
    - `customTrigger?: ReactNode | ((open: boolean) => ReactNode)`: Enables custom icon triggers while retaining standard menu lifecycle, keyboard escape handling, and floating surface.
    - `footer?: ReactNode`: Renders an optional footer/controls section at the bottom of the popup.
    - Automatic popup sizing: `min-width: 100%; width: max-content; max-width: 340px;` ensuring compact triggers have ample room for menu items without squishing.
- Verification: Full TypeScript check (`tsc --noEmit`), ESLint (`eslint .`), and Prettier check (`npm run format:check`) pass with 0 errors. Unit tests pass cleanly.

2026-10-23 Titlebar Controls, Rail Reordering, Dynamic Version & DropdownMenu Migration:

- Titlebar Layout & Window Actions:
  - Relocated Sidebar toggle (`PanelLeftClose`/`PanelLeftOpen`) and Preview toggle (`PanelRightClose`/`PanelRightOpen`) to the custom title bar ([App.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/App.tsx)).
  - Buttons are positioned in `.window-titlebar-actions` (`margin-left: auto`) immediately to the left of the native Windows minimize/maximize/close controls (with `-webkit-app-region: no-drag`, 24x24px sizing, pill/surface radius, hover shading, and full accessibility via `aria-label="Toggle sidebar"` and `aria-label="Toggle preview"`).
  - Dynamic Version Badge: Replaced hardcoded "v0.0.4-alpha" with dynamic application version fetching via `window.textra.getAppInfo()` in `App.tsx`.
- Activity Rail & Preview Reordering:
  - Left Activity Rail: Removed `.activity-rail-header` so **Files** (`Files` icon) is now the very first icon at the top of the left rail.
  - Preview Pane: When collapsed, **Compile** (`CompileControl`) is now the first icon at the top. Removed redundant expand/collapse toggle buttons from `preview-collapsed` and `preview-header`.
- 100% DropdownMenu Migration across Entire Codebase:
  - Replaced every remaining native HTML `<select>` element across all renderer components with the unified `DropdownMenu` component:
    - [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx): Editor font size dropdown.
    - [SetupDialog.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/onboarding/SetupDialog.tsx): Theme, base theme, tab close buttons, quiet period, ChkTeX timing, and default recipe.
    - [RecipeDialog.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/onboarding/RecipeDialog.tsx): Tool presets, new tool selector, project default recipe, root document selector, step tool, add step dropdown.
    - [CompileRecipeEditor.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/compile/CompileRecipeEditor.tsx): Recipe selector, step tool selector, project default recipe.
    - [ToolEditorDialog.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/compile/ToolEditorDialog.tsx): Program command preset selector.
    - [AIProviderEditor.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/chat/AIProviderEditor.tsx): Model visibility mode, connection default model.
    - [PdfViewer.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/pdf/PdfViewer.tsx): PDF zoom presets & fit width (`fullWidth={false}`).
  - Zero `<select>` elements remain in the entire `src/renderer/src` tree.
- Verification: 47/47 unit test files and 524/524 tests pass. `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`eslint .`), and `npm run format:check` (`prettier`) all pass cleanly with zero warnings or errors.

2026-10-23 Reusable DropdownMenu / SelectMenu Component Standard:

- Reusable Component Standard: Established `DropdownMenu` (also exported as `SelectMenu`) in `src/renderer/src/components/DropdownMenu.tsx` as the IDE-wide standard component for all dropdowns, select menus, and action popups:
  - Visual Design & Heritage: Directly mirrors the design of the formatting toolbar heading menu (`.editor-format-heading-trigger`, `.editor-format-heading-menu`). Styled with pill-shaped borders (`var(--radius-pill)`), floating elevation (`box-shadow: 0 8px 24px #0004`, `border-radius: var(--radius-surface)`), smooth caret flip animation, and hover/focus shading.
  - Features: Supports generic typed values (`<T extends string>`), single items or grouped items (`DropdownMenuGroup`), item icons, descriptions (e.g. `(missing)` or shortcuts), active item checkmark indicator (`Check` icon), outside-click auto-dismissal (`mousedown`), `Escape` key handling with trigger refocussing, and disabled states.
  - SetupDialog Integration:
    - Root Document Selector: Replaced native `<select>` in `SettingRow label="Root document (.tex)"` with `<DropdownMenu>`, displaying Auto-detect, sorted project `.tex` files, and missing file states with active checkmarks.
    - Action Select Menu: Refactored `ActionSelectMenu` in `SetupDialog.tsx` to reuse `DropdownMenu`.
- Memory Rule: All future dropdowns, popups, and select controls across the application MUST use `<DropdownMenu>` / `<SelectMenu>` from `src/renderer/src/components/DropdownMenu` rather than native HTML `<select>` elements or ad-hoc custom implementations.

2026-10-23 Root Document (.tex) Selector in Settings:

- Root Document Setting in Settings: Added a "Root document (.tex)" setting row under the Compilation section in Settings ([SetupDialog.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/onboarding/SetupDialog.tsx)) and in Advanced Project Settings ([RecipeDialog.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/features/onboarding/RecipeDialog.tsx)):
  - Selector Component: Uses the standard `<SettingRow>` and `<select>` component styled consistently with all other Settings fields.
  - Sorting Implementation: Filtered to `.tex` files in the open project and sorted using `sortProjectTexFiles`:
    - Root-level `.tex` files first (`!file.path.includes('/')`), sorted alphabetically by file path.
    - Subfolder `.tex` files second (`file.path.includes('/')`), sorted alphabetically by relative path.
  - Non-destructive Selection & Persistence: Supports selecting an explicit `.tex` document or "Auto-detect" (with current detected root displayed in parentheses). Changing the selection persists to `.textra/settings.json` via `setProjectConfig` while preserving all existing project settings, and updates the workspace's active `rootFile` and `projectConfig` state.
  - Compilation Integration: Updated `compile()` in [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx) so that if `projectConfig.rootFile` is configured, builds target the configured root document while continuing to default to the active document when unset.
- Verification: 10/10 workspace-state unit tests pass including sorting and filter tests. Full TypeScript check (`npm run typecheck`), ESLint (`npm run lint`), and Prettier (`npm run format:check`) pass with zero errors.

2026-10-23 Welcome Screen Redesign & Branding Updates:

- Modernized Welcome Experience: Redesigned `.welcome-content` in [Workspace.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/Workspace.tsx) and [styles.css](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/styles.css):
  - Layout & Positioning: Centered vertically in the viewport (`margin-top: auto; margin-bottom: auto`) and positioned horizontally in the left third (`margin-left: clamp(36px, 8vw, 130px); margin-right: auto`). Expanded card and container width to `max-width: 740px` (with `max-width: 300px` for quick action items), providing ample room for long file paths in the Recent Workspaces card without aggressive truncation.
  - Heading & Tagline: Updated heading to `TeXtra` and introduced tagline: "Fast, local LaTeX with intelligent writing assistance."
  - Action Items: Replaced old pill button and checklist with vertical action rows:
    - "New File..." with larger `FilePlus2` icon (triggers inline file creation when a project is open, or project selection when closed).
    - "Open File" with `FileText` icon (reveals and switches to the explorer tab when a project is open, or triggers folder selection).
    - "Open Folder" with `FolderOpen` icon (triggers `openFolder()`).
    - "Generate Workspace" with `AIChat` icon: Programmatically initializes or completes a workspace safely (inspects existing settings in `.textra/settings.json` and only populates unset defaults without overwriting existing configuration, writes a minimal compile-ready Hello World `main.tex` only if missing, and opens the root file in the editor; prompts for a folder if no folder is open).
  - Recent Workspaces Card: Structured card below quick actions presenting the 5 most recent workspaces. Displays each root project name as an interactive link with the full path beside it in faded text. Includes a "More..." action at the bottom triggering the folder chooser.
- Verification: 56/56 test files, 595/595 unit & integration tests pass. `npm run typecheck`, `npm run lint` (zero warnings), and `npm run format:check` pass.

2026-10-23 Dedicated Markdown Preview Tab & Independent PDF View:

- Markdown Preview Separation: Decoupled Markdown previews from overriding the PDF preview window. The PDF preview canvas, scroll position, and loaded PDF state are fully preserved in `#preview-panel` when opening or inspecting Markdown documents.
- Official Markdown Mark: Added `MarkdownLogo` matching Dustin Curtis's official Markdown Mark (viewBox `0 0 208 128`, rounded container, `M`, and down arrow `↓`) in [icons.tsx](file:///c:/Users/aaron/Dropbox/repos/textra/src/renderer/src/icons.tsx).
- Preview Tabs Integration:
  - Added a dedicated "Markdown" preview tab directly beside "Output" (`['preview', 'problems', 'output', 'markdown']`) displaying the Markdown logo.
  - The Markdown tab dynamically appears whenever a `.md` document is active or open in any editor tab (`hasMarkdown`), and cleanly disappears when all Markdown documents are closed (falling back safely to `'preview'`).
  - Added collapsed preview icon button support for Markdown in `.preview-collapsed`.
  - When opening a Markdown file (`selectFile`, editor tab click, or active path change), the right preview pane automatically switches to `panel: 'markdown'`.
  - Users can freely toggle between "Preview" (most recently compiled/loaded PDF) and "Markdown" without losing their PDF or restarting their view.
- Verification: 56/56 test files, 595/595 unit & integration tests pass. `npm run typecheck`, `npm run lint` (zero warnings), and `npm run format:check` pass.

2026-10-23 UI Updates & Editor/History Polish:

- Titlebar Version Badge: Added a subtle pill version badge `v0.0.4-alpha` beside the TeXtra title in the custom window titlebar (`.window-titlebar-version`).
- History & Projects Polish:
  - Narrow Pane Snapshot Actions: Refined the `...` snapshot card action popup menu (`.history-action-menu` and `.history-menu-item`) with matching padding, elevation (`box-shadow: 0 8px 24px #0004`), and radius (`var(--radius-pill)`) following the formatting bar dropdown conventions.
  - Diff View Heading Style: Updated `HistoryDiffView` header (`.history-diff-header h2`) to use the application's clean sans-serif typography (`var(--font-sans)`, 13px, font-weight: 600) instead of hardcoded serif Georgia.
  - Pinned Snapshot Labels: Removed quotes from custom labels across `HistoryPanel` and `HistoryDiffView`. Styled labels with muted italic typography (`font-style: italic`).
  - Section Collapse & Header Hover: Fixed narrow-width collapse behavior in `HistoryPanel`. Enforced `max-height: 32px !important; overflow: hidden !important;` on `.history-section.collapsed`, added `flex: 0 1 auto; min-width: 0;` text truncation to `.history-header-filename`, and prevented double borders when collapsed. Configured dual hover states on `.history-section-header`: hovering the section as a whole shades the entire row (including the `+` button area) seamlessly, while hovering directly over the `+` button isolates shading to just the circular icon button.
- Monaco Find Widget Freeze Fix: Replaced recursive DOM mutation observer on the Monaco editor find widget with non-blocking capturing pointer event listeners on the editor container and global `.monaco-hover` pointer-events suppression, completely eliminating the UI thread lock when opening find/replace (`Ctrl+F`).
- Verification: 56/56 test files, 595/595 unit & integration tests pass. `npm run typecheck`, `npm run lint` (zero warnings), and `npm run format:check` pass.

2026-10-23 UI Updates & File History harmonized release:

- Typography: Standardized heading 1 to match the sans-serif font theme (`var(--font-sans)`) across global styles and Markdown preview, eliminating discordant serif styling.
- Titlebar Search: Refined `Ctrl K` / `Cmd K` indicator to plain faded text (`color: var(--faint)`) without badge borders or background fills.
- File History & Projects Refinement:
  - Header & Filename: Removed the separate 29px subheader bar. Placed the active file name in subtle ghost text beside "File History" inside the section toggle. Added continuous bottom border across the header spanning both the section toggle and Create Snapshot button.
  - Delete Icon Button: Standardized the Delete trash button into an unbordered icon button matching all other icon controls in the interface.
  - Narrow Pane Responsiveness: Automatically monitors pane width with a `ResizeObserver`. When narrow (<280px), collapses the horizontal action buttons behind a sleek "..." popup menu (Compare, Pin/Unpin, Restore, Export, Delete) and stacks Date, Time, and Size vertically without truncation.
  - Sticky Headers: Sticky date group headers now float completely flush to the top edge (`top: 0`) edge-to-edge without padding offsets or content leaking.
  - Diff View Exit: Replaced the bordered "Exit" button in `HistoryDiffView` with a clean borderless "X" icon button.
- Editor Find Tooltip Fix: Intercepted `mouseover` and `pointerover` capturing events on the find widget close button to prevent Monaco's `HoverService.setupDelayedHover` from scheduling or rendering obstructive hover widgets over the close button.
- Verification: 56/56 test files, 595/595 unit & integration tests pass. `npm run typecheck`, `npm run lint` (zero warnings), and `npm run format:check` pass.

2026-10-23 Automatic File History feature (flat-file compressed backups in .textra/history):

- Architecture: Main process `HistoryService` manages gzip-compressed flat-file snapshots inside `<projectRoot>/.textra/history/<relative-path>/` with metadata recorded in `.textra/history/index.json`. Windows-safe ISO filenames replace `:` with `-`.
- Tree scan exclusion: `ProjectService.walk` ignores `.textra/history` subtrees to prevent performance degradation or tree entry limit exhaustion.
- Triggers: Automatic snapshot creation on file save, build compile (root file), pre-AI review edit application, and configurable periodic interval timer (default 10 min) for dirty editor buffers. Deduplication skips redundant writes when SHA-256 revision is unchanged unless forced.
- Tiered retention lifecycle: Automatic pruning algorithm keeps all snapshots for 0–30 days, 1 snapshot per day for 31–90 days, 1 snapshot per week for 91–365 days, and 1 snapshot per month for >365 days. Pinned versions or snapshots with custom labels are exempt from pruning.
- Data safety: Pre-restore automatic backup snapshot of the current disk file is created before any historical version overwrites disk content.
- UI & Monaco integration:
  - `HistoryPanel`: Chronological snapshot tree grouped into Pinned, Today, Yesterday, Earlier this week, and Older, with trigger badges, custom labels, and direct action triggers (Compare, Pin, Restore, Export).
  - `HistoryDiffView`: Side-by-side read-only Monaco Diff Editor (`original` = historical snapshot, `modified` = current working copy) with theme synchronization and action bar.
  - Access points: Activity bar rail button (`Clock` icon), File Explorer context menu ("View File History"), Editor Tab context menu ("View File History"), and Command Palette entries ("View file history", "Create history snapshot").
  - Preferences: "Files & Diagnostics" section in `SetupDialog` exposes history enable toggle and interval duration (1–120 minutes).
- Verification: 56/56 test files and 592/592 vitest unit/integration tests pass. `npm run typecheck`, `npm run lint` (zero warnings), and `npm run format:check` pass. Production build succeeds with lazy-loaded history bundle chunk.

2026-10-23 Startup and UI refactor (implemented and Windows native workflows verified):

- Preserved the owner's title bar, logos, recent styling, shortcuts and cleanup behavior.
- Shared pane headers/icon controls and Compile/Problems components; settings and provider
  editing now load on demand. Advanced project JSON/output controls remain reachable.
- Active-first versioned session restore, background tabs without focus changes, partial tree
  readiness and deferred project initialization/tool detection. Monaco, PDF.js, optional panes,
  icon catalogue and AI editor extensions have independent load boundaries.
- Last compiled PDF metadata is main-owned and fingerprint/hash validated; restored SyncTeX
  remains blocked until a successful current build. AI preparation imports enabled default
  adapters offline, without decrypting keys, networking or warming models; test AI stores isolated.
- Background project analysis reads four files per yielded batch and caches changed-file parses.
- All 12 functional native scenarios pass across serial runs; live-provider integration was
  intentionally skipped. Startup restoration tests also enforce a normal-sized editor.
- Evidence so far: full unit/integration 586/586, typecheck, lint (zero warnings), format:check
  and production build pass. Initial renderer entry 485.33kB minified versus pre-refactor
  10,124.40kB unminified; benchmark comparison caveats in docs/PERFORMANCE.md.
- Final three-sample benchmark with an OS-temp profile and normal editor-size assertion passes:
  median editor 17.074s, compile enabled 17.087s; warm target unmet. Earlier collapsed-layout
  samples are explicitly superseded. Next: packaged desktop startup/first-paint profiling and
  existing cross-platform/phase verification gates; see docs/PERFORMANCE.md.
- Launch: npm run dev. No commit or push performed.

2026-10-22 Comprehensive UI polish, Build tab synchronization, recursive auxiliary cleanup, and styled action popups:

- Writing Tab Collapsible Sections: removed pill borders, backgrounds, and `border-radius: var(--radius-pill)` overrides on `.writing-section` and `.writing-section-toggle` with `border-radius: 0 !important`, producing flat, edge-to-edge section headers.
- Build Tab Compile Button Clone: header Compile button is now an exact visual and behavioral clone of the Preview Compile button, matching status text ('Success!', 'Failed', 'Compile', 'Cancel'), `--progress` inline style, and `data-progress` attributes.
- Recipe-Aware Auxiliary File Cleanup: `cleanAuxiliaryFiles` resolves document recipe plans (`planRecipe`) to discover exact auxiliary and output directories (`plan.auxiliary`, `plan.output`), recursively traverses build directories to delete all auxiliary artifacts (`.aux`, `.bbl`, `.fls`, `.fdb_latexmk`, `.log`, `.synctex.gz`, `.toc`, `.nav`, `.snm`, `.vrb`, etc.), while strictly preserving `.pdf` and source files.
- Assistant Tab Code Block Copy: fenced code block copy button checkmark now smoothly fades back to the copy icon after 2.5 seconds via `useEffect` timeout and CSS transition.
- Keyboard Shortcuts Dropdown: replaced native `<select>` with a custom dropdown popup matching the formatting bar Headers menu (`.editor-format-heading-trigger` / `.editor-format-heading-menu`), featuring a default "Select Action" prompt, caret down icon, keyboard/click outside dismissal, and formatted shortcut hints.
- Problems Pane Height Symmetry: standardized `.problems-toolbar` and `.problems-filters` to exactly 29px (`height: 29px; min-height: 29px; max-height: 29px; box-sizing: border-box; padding: 2px 8px`), matching `.editor-format-toolbar` in the editor pane for symmetry.
- Verification: 489/489 unit tests pass, integration tests pass, `npm run typecheck` passes with 0 errors, `npm run lint` passes with 0 errors, `npm run format:check` passes with 0 warnings.

2026-10-22 UI/UX refinement & visual hierarchy polish:

- File tab save animation: tab titles remain steady while a subtle accent border flare animates on save alongside unsaved dot clearing. Removed distracting "Saved" text swap and heavy box-shadows.
- Editor word selection: fixed Monaco Ctrl+Shift+Left/Back selection behavior by immediately clearing navigation intent state on jump triggers, allowing uninterrupted multi-word selections.
- Navigation rail & layout: standardized sidebar collapse row to 40px centered without a bottom border; relocated the Search tab to the bottom rail section directly above Recent Projects.
- Appearance & Theme Colors: theme color pickers (Accent, Strong Accent, Accent Background, Background, Surface, Text) are now compact, borderless filled color swatches that automatically sync with built-in theme presets and custom theme definitions. Expanded Settings dialog to 940px width and nav to 195px to prevent line wrapping.
- Files Tab: redesigned top section into three distinct rows: (1) title, Open Folder button, and right-aligned Reveal in Explorer / Open in VS Code icon buttons, (2) file search input, (3) transparent root directory path with New File / New Folder actions. Removed dead "Refresh project" button and wiring.
- Writing Tab: removed pill containers around collapsible Outline and Notes sections; fixed section collapsing layout bug so neither section is clipped when both are collapsed; updated Notes icon to notepad & pen (`NotePencil`) and added `ListChecks` for `% TODO` items; removed circular borders on header action buttons; removed dead focus mode stub.
- Build Tab & Compilation: fixed Compile button and Problems button flex overlap in header; wrapped Recipe Editor with proper horizontal padding; populated "Default recipe for new documents" with all available presets and project-specific custom recipes.
- Snippets Tab: moved "+" action inside the Templates & Snippets card as a faded full-width "+ Add snippet" button at the bottom.
- Assistant Tab: simplified empty state prompt to a single concise line; configured composer textarea to auto-grow up to 180px with input lines; added dismissible provider notice that stays hidden until the active model is switched.
- Formatting & Editor toolbar: added direct output PDF button next to Hide in formatting toolbar, enabled when a compiled PDF exists; matched Problems toolbar height to the formatting toolbar for visual symmetry.
- Markdown Preview: removed the "Previewing <filename>.md" top bar for clean, unobstructed rendering.
- Verification: 556/556 vitest unit and integration tests pass, typecheck passes with 0 errors, ESLint passes with 0 errors and 0 warnings, Prettier format check passes.

2026-10-22 Settings integration & dialog consolidation:

- AI Settings: eliminated duplicate `AISettingsDialog` modal dialog and DOM portal container injection hack. Converted AI settings into an integrated inline panel (`AISettingsDialog` / `AISettingsPanel`) embedded directly in `SetupDialog` under the `ai` section. Header gear icon, unconfigured card action, and provider warning triggers in `ChatPanel` directly open `SetupDialog` at `section: 'ai'`.
- Recipe Management: embedded `CompileRecipeEditor` directly inside `SetupDialog`'s Compilation tab (`section: 'compilation'`). The "Manage recipes…" compile dropdown button and Command Palette item now route to Settings -> Compilation instead of opening an external standalone recipe dialog.
- Open Settings Routing: `textra:open-settings` custom events and Command Palette entries ("AI settings", "Manage compile recipes", "Configure keyboard shortcuts") now reliably navigate to specific sections (`ai`, `compilation`, `shortcuts`, `appearance`, etc.).
- Verification: 556 unit and integration tests pass, typecheck passes, lint passes with 0 errors/warnings, prettier format check passes.

2026-10-22 UI/UX audit, Build tab refactor, and Settings customization follow-up:

- Build tab: renamed from "Compile" to "Build"; header houses matching primary Compile
  and Problems button copies on one line; removed "Project health", "Generated files", and
  "Document formatting"; simplified the recipe editor with faded "+ Add", step edit icon opening a
  common modal ToolEditorDialog, and "Save" / "Save As" actions; card styled as an open section.
- Writing tab: fixed latexindent executable lookup and % TODO / % FIXME comment-boundary parsing;
  header features Document Format button beside Focus button (standardized 24px icon buttons);
  Outline panel is placed first followed by Notes with a vertical resizable splitter defaulting
  Notes to a compact collapsed height.
- Snippets tab: Math Symbols & Templates sections are collapsed by default with lock icons and
  settings toggles to persist open-by-default preferences; custom snippets are consolidated into
  the main card with inline add/delete controls and dedicated snippet prompts.
- Chat & Models: Model picker chevron flips up; Ctrl/Cmd+/ toggles the picker; active file pill
  positioned northwest above the composer and restricted to Agent mode; header buttons standardized
  to 24px icon-only with tooltips.
- Appearance & Custom Themes: support custom UI font and Monaco editor font; custom theme builder
  in SetupDialog saving to preferences with live CSS variable injection for background, surface,
  accent, and text colors.
- Editor & Diagnostics: removed document length constraint for editor minimap (remains off by
  default); added official ChkTeX documentation manual link for rule codes and severities; fixed
  Monaco find widget hover tooltip pointer obstruction; keyboard shortcuts viewer supports adding
  and editing custom key bindings; clicking a PDF in the file tree automatically opens and focuses
  the PDF preview pane; split compile button error styling covers both halves on failure; document
  saving replaces toast with a subtle accent pulse on the tab pill.
- Verification: 556/556 vitest unit and integration tests pass, typecheck passes, lint passes with
  0 errors and 0 warnings, prettier format check passes, electron-vite production build passes.

2026-10-22 Agent deletion follow-up: authorized Agent runs now have an exact-source
delete_range tool. Deletions remain staged for explicit review and cannot directly write files.
The shared prompt briefly guides literal LaTeX backslashes and balanced braces/environments.
Code-block copy controls are icon-only. Custom snippet creation offers a copyable editable
prompt and a prefilled Ask in Chat draft that bypasses automatic sending.

2026-10-22 assistant activity UI follow-up: reasoning-only streams no longer render an empty
Markdown preview. Chat/Agent thinking uses animated ellipsis dots; the active document editor
gets a subtle pulsing accent border only during an authorized Agent request. Reduced-motion
preferences disable both animations while retaining the editor cue.

2026-10-22 assistant display follow-up: typed SDK reasoning deltas now cross the validated
preload bridge and render in a faded, collapsed-by-default panel only when the provider returns
them. Gemini 2.5/3 receives includeThoughts; other Google-compatible models do not. Reasoning is
excluded from future provider turns and saved chat history. Fenced code has an always-visible,
working copy button in user and assistant bubbles. Fixed the composer flex hit targets so the
context chip/model label cannot cover the model or cancel controls. Focused unit checks pass
19/19, typecheck and build pass, lint passes with the existing draft dependency warning, and the
native chat e2e passes 1/1 (34.3s), including collapsed reasoning and both copy controls.

2026-10-22 chat follow-up: a fresh prompt after an unanswered/failed user turn now remains a
separate visible bubble; adjacent same-role turns coalesce only at provider serialization.
User messages now render through the safe MarkdownPreview component, including fenced code.
Typecheck and focused conversation/Markdown unit checks pass (5 tests). Native UI check not run.

2026-10-22 assistant UX follow-up: restored the Chat/Agent switch over the SDK assistant.
Chat is the default, sends no document/tools, and Problems' Ask in AI forces Chat. Agent
manual Send explicitly authorizes the active .tex snapshot; the agent receives it as
untrusted context and can stage a direct edit without a separate initial read call.
Document sync only cancels an in-flight request bound to that document. Per-hunk approval
can advance using the live renderer snapshot while main remains authoritative for context
validation. Follow-up diagnosis confirmed the reported Google failure was HTTP 503/high demand,
misreported as network failure because SDK errors were not normalized at the assistant runner.
Assistant errors now normalize status and safe response detail. Gemini 3.5 Flash-Lite uses
minimal thinking for Chat, low for Agent, and provider stream retries are disabled. Typecheck
passes; targeted assistant/runtime tests pass 48/48. Native Windows interaction remains
unverified. Agent response latency remains model/network dependent, and tool edits still
require model tool-call and final-response work.

2026-10-21 AI SDK migration (working tree, not committed). Chat and Agent are replaced by one
SDK-backed assistant: main builds models with the Vercel AI SDK 7 (ai-sdk-runtime.ts, guarded
fetch, maxRetries 0, lazy provider packages), assistant-runner.ts uses ToolLoopAgent with the
four pathless tools over the extracted staging buffer (agent-staging.ts), and the renderer uses
useChat with an Electron IPC transport (assistant-transport.ts). Ctrl+I streams a growing
preview; chat-based automatic completion uses streamText; Codestral FIM and Ollama generate stay
native. Settings v5 migrates Chat/Agent to Assistant. Custom SSE/chat/tool transcripts and
@google/genai are removed. Evidence (Linux container, 2026-10-21): typecheck, lint, build pass;
vitest 525 pass with 9 pre-existing real-TeX integration failures caused by the container's
TeX install; Electron e2e agent, chat, completion, provider-settings, shell, ui-consistency and
editor-word-selection pass under xvfb. project-workflow and recipes fail on Linux for
environment reasons (external watcher, real TeX). Windows native e2e has not been rerun.
Also fixed: projectFileUri produced file://// on POSIX roots, crashing Monaco on file open.
Next: run npm install (lockfile updated) and the serial Windows e2e suite, then commit.

2026-10-21 provider v4 and prompted Ctrl+I redesign is implemented. Full unit 557/557,
native matrix 7/7, typecheck, lint and production build pass. Live local Qwen3B prompted edit and FIM pass; paid-provider live checks are blocked
by isolated-profile key decryption. Exact evidence and remaining normal-profile checks are in [implementation tally](AI_SETTINGS_IMPLEMENTATION.md).
Preserve user sandbox/test.tex changes; no unrelated phase gates advance.
Launch: npm run dev (restart for main/preload changes).
Source milestone: Add prompted inline editing and provider management (see git log -1).

2026-10-21 automatic-completion revision: target 1–10 lines/384 tokens instead of
stopping after the first useful line. Local Ollama automatic requests get 30s;
remote automatic requests get 10s. Ctrl+I stays 20 lines/512 tokens and 30s local,
15s remote. New bindings prefer installed Qwen2.5-Coder0.5B. Monaco word suggestions
are off; deterministic LaTeX/TexLab completion only runs for commands/structured
arguments, leaving prose quiet. Provider checks pass 53/53 with multiline, CRLF,
line-budget and suffix-stop coverage. Saved automatic model is now local
qwen2.5-coder:0.5b, with enabled consent and other role bindings preserved through
validated IPC. A live synthetic supply/demand TikZ request returned four lines/836
characters in 13.669s. Full unit checks pass 494/494. Native completion and shell checks pass 2/2
(31.7s/53.8s), covering quiet prose, multiline Tab insertion and one-step Undo.
Typecheck, lint, changed-file formatting and production build pass.
No phase gates advance.
Launch npm run dev after rebuilding main/preload changes.

2026-10-21 Qwen/TexLab follow-up: fixed a diagnostics/sync feedback loop by making
unchanged TexLab source idempotent and decoupling source sync from adapter identity.
Queries deduplicate, supersede/cancel on edits, close/reopen safely, and have bounded
8-active/64-total queues. Queued time counts toward deadlines. Local Qwen generation
stops at a useful automatic line or echoed suffix rather than waiting for EOS and
explanations. Local-only context is reduced to 1,024/256 (auto) or 4,096/1,024
(Ctrl+I) prefix/suffix characters; local deadlines are 10/30s, remote stay 2.5/15s.
Expected completion cancellation/busy is quiet; true timeouts have their own code.
Live main-service Qwen3B Ctrl+I succeeds (16.354s); the user's existing consented
Qwen1.5B automatic binding succeeds (1.498s) with synthetic code context. No model
choices, credentials, or consent settings changed. Real bundled TexLab burst
regression and mocked adapter/protocol regressions pass. See TESTING for final checks.

2026-10-21 inline completion implemented: four independent saved AI roles, v3
atomic config migration preserving keys/catalogues and separate Chat/Agent/Ctrl+I session
choices. Automatic starts off, requires native consent tied to its exact model,
and stays inside non-document environments/math unless outside continuation is
enabled. Shared scanner handles unfinished/custom environments, comments, math,
minted/lstlisting languages and literal contents. Ctrl+I works in editable TeX prose,
continues after selections, and exposes an anchored model/regen/accept/dismiss bar.
Both modes show ghost text and accept through one guarded undoable insertion.
Main validates scope, capabilities, consent, bounds and request identity; native
Codestral/Mistral FIM, verified local Qwen generate and shared chat completion
routes never fall back. Foreground work preempts automatic only; cancellation is
request-specific, including cancellation before canonical validation completes.
Missing models clear role bindings; removed temporary choices never silently revive.
470/470 unit/integration tests pass serially. See TESTING.md for native/live evidence.
Live first probe: Qwen3B timed out at 15s, Codestral unconfigured, Google saved key
cannot decrypt in the test OS session. No keys changed or models downloaded.
Launch npm run dev. GitHub and all unrelated roadmap phase gates remain deferred/open.

2026-10-21 Codestral: dedicated nested setup card inside Mistral, backed by its
own encrypted codestral provider profile at codestral.mistral.ai/v1. Catalogue
parent metadata drives nesting; child form/default/refresh/remove/draft saves
work independently of the general Mistral connection. Listing accepts Codestral
IDs only, excludes explicit non-chat capabilities, and never falls back to the
general Mistral key/host. Chat/Agent transport and system instructions are shared.
Full Windows suite 421/421 passes with normal permissions; see TESTING.md for
native/static evidence. GitHub is explicitly deferred by owner; no pending choice.
Launch npm run dev. Next: native/provider validation as recorded, remaining
roadmap gates and optional future GitHub work only when requested.

2026-10-21 OpenRouter: encrypted setup card, authenticated /models/user text-only
catalogue respecting account preferences, shared Chat/Agent transport and prompts.
Requests set require_parameters=true/allow_fallbacks=false; automatic auto/free
router IDs are excluded. Agent reasoning_details/reasoning survive replay.
Full tests 416/416 pass with normal Windows permissions; typecheck/lint/build pass.
GitHub portion was deferred by the owner after the in-chat choice:
GitHub Models retired 2026-07-30 (official docs); do not implement its old PAT endpoint.
Recommended alternative: official Copilot SDK, sign-in or fine-grained PAT with
Copilot Requests; disable built-in tools/discovery and preserve TeXtra prompts,
bounded staging and approval. This needs its own runtime integration, not another
Chat Completions URL. No Copilot dependency or credentials added yet.
No GitHub work remains active. Future live-provider verification uses user-supplied
setup. Launch npm run dev.

2026-10-21 AI setup/catalogue refactor: Mistral and DeepSeek added to the shared
provider catalogue, encrypted settings and fixed-endpoint Chat/Agent routing.
They share Chat Completions transport with OpenAI; max_tokens stays distinct from
OpenAI's max_completion_tokens. DeepSeek reasoning_content is replayed for tools.
Chat uses one unchanged CHAT_SYSTEM_PROMPT, tested verbatim across all seven wires.
ai-models.ts centralizes text-model family/modality filtering and cache cleanup;
Mistral completion_chat and Ollama /api/show completion capabilities refine discovery.
Ollama checks four models at a time; 404/405 metadata endpoints use the ID fallback.
Old cached specialist models are hidden and cannot be chosen for default/request;
keys remain intact. Refresh models performs full capability discovery.
Setup cards/copy are shorter; unused protocol metadata removed; Cancel replacement
clears the abandoned key draft. Native Chat checks all seven cards and passes;
verification details in TESTING.md. Launch npm run dev. Phase gates unchanged.

2026-10-21 UI consistency and Agent reliability: action/menu buttons and native/model
dropdowns use pill radii; Appearance select uses border-box paint with content insets.
Native scrollbars share a 5px arrowless style; source and diff Monaco editors use
matching narrow scrollbars without shadows/arrows. Snippets & Symbols and Writing
scroll as whole views instead of clipped/nested cards. New native ui-consistency spec
covers real wheel scroll, custom-form reachability, and dark/light dropdown geometry.
Agent now permits 24 provider responses/64 tools (previously six/twelve), reports
remaining budget each turn, encourages batching, and identifies the exhausted cap.
Deadline remains 90s (180s Local Ollama); scope/review/stale guards and discard-on-cap
remain. Unit/integration suite: 391/391 pass with normal Windows permissions;
typecheck, lint, production build and changed-file formatting pass. Native checks
and screenshot review are recorded in TESTING.md. Launch: npm run dev.
Remaining roadmap gates unchanged: native/platform matrix and release work.

2026-10-21 Save footer: Settings and AI settings dialogs share SaveFooter
(features/save-status). It shows autosave state (ui.ts saveState for preferences;
trackAISave/useAISaveState for AI writes) with an animated check, and Save settings
waits for pending writes, submits typed API keys, plays a confirm animation and closes.
Typecheck/lint pass; headless Chromium screenshots reviewed. E2E not run.

2026-10-21 Multi-provider AI: GeminiService replaced by AIService (ai-service.ts) plus
fixed-endpoint adapters (ai-providers.ts) for Google, OpenAI, Anthropic, Ollama Cloud and
local Ollama. ai.json is now version 2 (v1 key migrates to Google). New AI settings dialog
(AISettingsDialog.tsx), searchable ModelPicker, useAISettings hook; AISettingsForm removed.
IPC: saveAIProvider/removeAIProvider/refreshAIModels/setAIProviderDefault/setAIDefaultModel/
getOllamaStatus/startOllama/openAIProviderLink; deleteAIKey/saveAIKey/openAIStudio/
openAIRateLimits removed. Agent turns are provider-neutral. Owner's saved key was deleted
at his request so he can re-enter it through the new dialog. Evidence: typecheck, eslint,
prettier pass; unit suite passes except the real-TeX integration tests on a machine without
TeX; new ai-service (22) and ai-providers (12) tests pass; renderer build plus headless
Chromium screenshots of the dialog, picker and chat reviewed. E2E specs (chat, agent, shell,
agent-live) were updated for the new flow but NOT run (no Electron binary in the Linux VM).
Not verified live against real provider APIs; OpenAI/Anthropic/Ollama tool calling is
implemented from their documented formats.

2026-10-20 Chat history deletion and Problems mode handoff: history menu now offers a
per-chat delete action with native confirmation. Main validates the workspace chat ID;
the workspace history service serializes deletion with saves and atomically rewrites the
transcript list. Removing the active transcript also clears it from the panel. Problems
drafts now force Chat mode (and its default model) before checking the saved auto-send
preference, so the Ask in Chat button works after Agent mode. Targeted lint and formatting
and typecheck pass. No tests were added or run in this slice.

2026-10-20 AI defaults/handoff complete: Chat and Agent both default to Gemini
3.5 Flash Lite and expose all seven configured Google models. Chat asks for concise
answers and labels actionable fixes; the latest completed suggestion shows an
Implement Suggested Fix pill. Clicking switches to Agent, preserves draft/history,
and explicitly sends the preceding conversation with a simple implementation request.
Agent's first-selection disclosure fades after five seconds and never repeats in
the same profile, including after restart. Active-.tex scope/review stay mandatory.
Live verification found repeated guessed insertion columns; line tables now expose
endColumn and recoverable errors give exact bounds, keeping existing budgets intact.
All 418 unit/integration tests pass; build/typecheck/targeted lint/format pass.
Native Chat and Agent verify menus/defaults, handoff context, disabled non-.tex input,
notice fading/profile restart and sequential review; shell smoke passes. Live Gemini
3.5 Flash Lite staged both lipsum edits and passed sequential approvals with unchanged
disk after the column-feedback fix. Earlier failed live attempts are superseded by
this passing rerun. Commit 9be0142 records the full working tree. Documentation cleanup
is now removing the obsolete master prompt and reducing duplicate roadmap/test history.
Launch npm run dev; remaining roadmap gates unchanged.

2026-10-20 Sequential Agent fix complete: multi-part editing now permits six model
calls/twelve text tools under the unchanged 60-second deadline. Instructions require
all requested parts, preserve original line targets after insertions, and use only
the final narration. Budget exhaustion discards staging instead of returning partial
edits. New narrow review IPC immediately approves/rejects named hunks, rebases only
undecided changes, and advances the expected buffer/context. Renderer applies each
approval undoably and removes it; the final decision returns to the normal editor.
Approve all applies the remainder, Reject all keeps previously approved text.
Auto-save pauses until review completes; stale async approvals discard remaining
work and preserve the current file. Validation: 82 focused backend tests pass;
full suite covered 386 tests (385 passed initially; one unrelated EBUSY preferences
fixture cleanup passed on the six-test rerun). Typecheck/lint/build/task-format pass.
Live Gemma 4 26B passed adding lipsum and replacing original line 28 in one proposal,
then approving both sequentially with unchanged disk. Native immediate approvals,
advancement, final dismissal, Undo, stale responses, chat and shell pass. Native
fixture now waits for firstWindow before replacing IPC to avoid a startup race.
Launch npm run dev. Prior unrelated renderer/sandbox changes remain preserved;
working tree remains intentionally uncommitted. Earlier roadmap gates unchanged.

2026-10-20 Bounded Agent/chat follow-up complete: checkpoint0ea59a2 committed prior
working changes first. Chat now preserves conversations/drafts across mode switches,
passes prior conversation to Agent, saves/restores workspace-specific local history,
sends on Ctrl+Enter, and uses immediate model menu options with smaller send control.
Chat adds Gemini3.8/3.6 Flash and3 Flash Preview; Lite defaults remain. Agent tools
support omitted read args, line/column insertions and exact-text replacement, with
safe bounded correction. Staged reads/valid edits finish inside3 calls/8tools.
Inline read-only diff replaces modal; per-hunk decisions or Approve all then Apply
approved changes exactly selected hunks, undoably, after context/disk/buffer checks.
Monaco wordOperations import fixes cumulative Ctrl+Shift+Arrow selection.
Evidence:377 full unit/integration tests pass, final agent/workspace73 and history4
reruns pass. Build/typecheck/lint/task-format pass. Native chat/history, word selection,
shell and final inline approval/reject/partial-apply/Undo/stale checks pass. Opt-in
live Gemma4 26B proposed and main accepted exact temporary-file lorem ipsum insertion;
disk stayed unchanged. Native screenshots reviewed. No plaintext key exposure.
Launch npm run dev. Remaining roadmap gates stay incomplete. This feature slice
remains uncommitted alongside concurrent unrelated renderer/sandbox changes, preserved
without staging or reverting them. Global format still flags sandbox/issues.md.

2026-10-20 Chat alignment polish: header uses shared --bar-height like editor/preview,
no wrapping, with compact 24px pill buttons. Rail uses a single chat-and-sparkles SVG
through the existing Phosphor IconBase/context. Send glyph shrank from 16px to 14px
and its circle from 28px to 26px. Typecheck/lint/format/build and native chat checks pass;
header height equality/pill radii asserted and final screenshot visually reviewed.
Launch npm run dev. Existing mixed changes remain preserved and uncommitted.

2026-10-20 Chat composer/response UX: assistant replies now use full-width Markdown
without provider headings or bubble borders. A small copy icon below copies raw Markdown
through the existing clipboard bridge, with success/error feedback. User messages retain
bubbles. The composer contains two text rows and an inset footer with an ellipsized,
disabled Gemini 3.5 Flash Lite selector plus circular send arrow; empty is transparent,
non-empty uses accent. During streaming the circle becomes Stop. Existing streaming,
cancellation, consent and single-key management remain. Typecheck, targeted lint/format,
production build and native chat test pass, including exact Markdown copy and circle states.
Native conversation screenshot visually reviewed. Launch npm run dev. Existing mixed
changes remain uncommitted.

2026-10-20 Single-key management: AI settings now show saved-key state with explicit
Replace key/Delete key actions. Replacement reveals a cleared password form, supports
cancel, and tests the candidate before atomically replacing the one encrypted key.
Delete uses a typed no-argument bridge with native confirmation (Cancel default),
clears encryptedKey and auto-send, and does not require OS decryption. Failed changes
preserve existing settings; active Gemini operations reject deletion. Forty-seven
focused service tests, typecheck, targeted lint/format, build, and native chat/shell checks
pass. Native coverage verifies replacement/deletion UI and real confirmation cancellation.
Existing mixed working-tree edits preserved. Launch npm run dev.

2026-10-20 Chat streaming/UI follow-up: Gemini uses generateContentStream for chat,
nonstreaming for key verification. Bounded cumulative chunks travel over typed,
request-ID-correlated IPC; stale chunks are ignored. Model bubbles render safe Markdown
and incomplete replies stay separate from request history. Ask and Cancel use the pill style;
intro/privacy hides once a question is sent. Chat follows output only near the bottom,
uses scoped subtle scrollbars, and has a single rail icon after the main views/search.
Typecheck/lint/targeted format/build pass; existing PdfViewer lint warning remains.
Full suite: 282/284 passed initially; two EPERM atomic-rename failures in Gemini and
project fixtures passed on retry (54/54 across the affected suites). Native chat and shell
pass, including streamed Markdown, Ask styling, placement, and stale-chunk protection.
Screenshot review caught the app-wide list reset; chat now restores bullet/number markers.
No live Google requests in automated checks. Launch npm run dev.

2026-10-20 Gemini credential follow-up: removed AIza prefix/shape validation.
Any non-empty trimmed key up to 8,192 characters reaches the Gemini verification
call before encrypted saving; failed verification preserves the saved key. Password
input now says Paste your API key. Forty focused Gemini service tests, typecheck,
targeted lint/format and production build pass. Native chat regression passes and
checks that New chat sends only the new question and retains unsent composer text.
Launch npm run dev (restart main if using an existing dev session).

2026-10-20 Gemini debugging slice: owner requested optional conversational AI now.
Only gemini-3.5-flash-lite via @google/genai 2.30.0, main-process requests, typed
preload APIs. AI Chat rail onboarding and Settings share key testing/settings UI.
Repository-local .textra-local/ai.json (ignored) uses safeStorage encryption;
unavailable/basic_text encryption refuses saves. TODO migrate to global app data
before public release. Problems prepares bounded +/-5-line editable drafts;
auto-send opt-in defaults off. No AI file/command tools. History stays in memory
and resets on project changes. Preserved all pre-existing working-tree changes.
Validation: 276 unit/integration tests pass with desktop permissions; typecheck,
lint (existing PdfViewer hook warning), build pass; native chat test passes.
Global format check flags pre-existing sandbox/issues.md; diff check flags existing
sandbox/test.tex whitespace. Native chat now passes including bounded editable Problems
drafts/default no-send and opt-in auto-send; screenshots visually inspected. Native shell
and recipes also pass serially. Project-workflow still expects the old inline conflict
banner at line108, while the existing working tree shows the new dialog (KNOWN_ISSUES).
Immediate cancellation and external AI-settings conflict regressions pass. Live Google key
and OS account migration are not tested. Launch npm run dev; configure AI Chat with an
AI Studio key. Earlier phase gates remain incomplete; leave existing mixed edits intact.

2026-10-20 External file overwrite handling (working tree): Main now combines canonical-path
native watching with 750ms revision polling, debounces atomic save sequences, and emits changing,
stable, deleted and renamed states after a configurable 2–5s quiet period. Any event locks the
open renderer buffer against normal save/autosave/Ctrl+S. The blocking dialog offers a collision-safe
`CONFLICTED_timestamp` sibling snapshot or closing TeXtra's buffer; a read-only Monaco comparison
is available once stable. Preferences add detection, quiet-period, polling-only and optional
post-snapshot diff controls. Focused tests pass; typecheck, lint, format check and build pass.
`npm run test:e2e` remains blocked in this managed desktop session: all three Playwright Electron
launches exit before a window binds (exit code 2147483651), so conflict-dialog interaction still
needs a normal desktop verification run.

2026-10-19 Phase 2 closeout (working tree): Phase 2's requested offline feature
set is implemented. The final gate is native verification, not further product
scope. Formatting, typecheck, lint, and the production build pass. The managed
runner cannot complete native UI automation, unrestricted Windows filesystem
tests, or MiKTeX registry access; run the matrix in `docs/TESTING.md` from a
normal desktop session. `validateProjectConfig` now rejects protected metadata
folders as compile roots, and `.vitest` is ignored by Prettier.

2026-10-19 Environment Enter fallback (working tree): terminal output showed
repeated failed `textra:texlab:request` calls. These are language-server
failures, not an Electron crash. To make paired environments independent of the
suggestion widget and TexLab, Enter after a complete `\\begin{name}` now inserts
an empty indented line and matching `\\end{name}`. It leaves a nearby existing
matching end alone. TexLab errors now carry their safe error code in main-process
logs and return a local-fallback message to the renderer. Typecheck, lint,
format check, and production build pass.

2026-10-19 Empty environment completion (working tree): accepting a local
`\\begin{…}` suggestion now uses a Monaco snippet to insert the closing brace,
an empty indented line with the cursor, and matching `\\end{…}`. It does not
add `\\item`, labels, captions, or any other environment-specific content.
Context-aware content templates are deferred to Phase 3 by owner decision.
Typecheck, lint, format check, and production build pass.

2026-10-19 Environment completion reliability (working tree): asynchronous
TexLab requests can be cancelled while Monaco replaces completion requests as a
user types, so environment suggestions were intermittent. `SourceEditor.tsx`
now serves standard `\\begin{…}` environments locally and synchronously, and
uses the closest unmatched `\\begin{…}` for `\\end{…}` completion. It ignores
unescaped LaTeX comments when building that environment stack. Typecheck, lint,
format check, and production build pass.

2026-10-19 Monaco completion widget fix (working tree): LaTeX automatic
suggestions were enabled but the modular Monaco build had omitted its Suggest
Controller contribution, so no suggestion widget could render. The contribution
is now imported in `SourceEditor.tsx` and Vite's optimized Monaco dependencies.
Typecheck, lint, and production build pass; the development app reached
`application-ready`. Native interaction testing of `\\begin{item` and
Ctrl+Space remains the next check.

2026-10-19 TexLab integration (working tree): TexLab 5.26.0 is bundled under
`resources/texlab/win32-x64/texlab.exe` for Windows x64. The pinned artifact hash, GPL-3.0
license text, attribution, and source URL live beside it. The default-enabled preference
controls an Electron-main JSON-RPC/LSP process, which owns document synchronization and returns
completion, diagnostics, hover, definition/references, symbols, folding, and inlay hints through
typed IPC. The renderer preserves local completion/folding fallbacks. Checks passed: the bundled
binary reports version 5.26.0; typecheck, lint, format check, build, and native app launch.
Remaining distribution work: provide matching macOS/Linux assets in installer packaging.

2026-10-19 Phase 2 language tooling slice (working tree): ChkTeX runs on explicit save
when available and returns source-linked diagnostics; latexindent formats through stdin and
shows a proposal before replacing the open buffer. The Problems panel merges build, ChkTeX,
and deterministic local reference diagnostics. Each problem has TeX Stack Exchange search,
copy troubleshooting prompt, and a disabled Ask in Chat placeholder. Prompt context uses the
smallest enclosing completed environment, otherwise 100 lines either side. Writing sidebar
shows counts, cursor-aware outline, TODO/FIXME, and a quiet focus control. The local parser
is comment/verbatim aware and scans up to 250 project .tex files for label/reference/image
checks. This description predates the bundled TexLab integration above.

2026-10-19 Problems follow-up (working tree): compiler diagnostics now reassemble immediate
unindented TeX line-wrap continuations, so searches and prompt copies receive messages such
as “Undefined control sequence.” instead of the clipped physical log line. Prompt copying
uses the main-process clipboard bridge because renderer clipboard permission is denied by
the secure Electron session. Save completes before best-effort linting begins.

2026-10-19 Phase 1 checkpoint: owner manually verified XeLaTeX and LuaLaTeX compilation.
SyncTeX remains untested in this UI round; macOS/Linux and crop/rotation fixture coverage
remain follow-up verification. The Phase 1 implementation is being committed as the
checkpoint before the offline language tooling and diagnostics Phase 2 slice.

2026-10-18 Snippets sidebar view (working tree): rail button with a "{ }" glyph
(sidebarView 'snippets'). features/snippets/snippets.ts holds 12 built-in snippets (table,
table with notes, figure, figure with subfigures, lists, equation, align, theorem and
proof, minipages, section, footnote). Double-click or Enter inserts through the same
textra:insert-source event as the equation palette; hovering shows needed packages. No
user-defined snippets yet. Owner confirmed equation double-click works. Not run natively.

2026-10-18 Equations moved to the left sidebar (rail button with sigma, sidebarView
'equations'); it has an Environments group (equation, align, matrices, cases, inline/display
math). Insert event is cancelable so the palette reports failure. Earlier note: Equations tab (working tree), originally a preview tab. features/equations/ holds a searchable palette of about 300 symbols in 14
groups (structures, Greek, operators, relations, arrows, big operators, sets, delimiters,
accents, functions, spacing). Double-click or Enter inserts at the cursor through a
textra:insert-source window event handled in SourceEditor (replaces the selection, cursor
lands at $0 or inside the first {}). Hover/focus shows the LaTeX and any needed package.
Glyphs are Unicode, no math renderer dependency. Not run natively.

2026-10-18 Compile progress (working tree): BuildState gained optional stepsDone/stepCount
(set in BuildService around the recipe step loop). The Compile/Cancel button fills via a
--progress CSS variable: (done + 0.5) / count, capped at 95%, animated with @property.
Step-based only; no page-count estimate. Drop-downs in Settings/Recipes/PDF controls are
themed (native open list still OS-drawn). Recipes and tools are edited separately, with a
draft-mode helper for early passes. Not run natively.

2026-10-18 Preview/Settings round (working tree): PDF page, zoom and locate controls now
render in the preview header (React portal into .pdf-slot) beside Compile and the Preview/
Problems/Output tabs; below 560px header width they collapse into a "..." menu. Output tab
has a Copy button in the header. Editor tab strip and preview header share --bar-height
(40px, border-box). Settings is a dialog with a section list (Appearance, LaTeX tools,
Compilation, Import & export); LaTeX tools rows show the path with a pencil (and an undo
icon for custom paths). Build recipes dialog opens on a recipe list (pencil per recipe),
Output location radios (build folder / PDF beside .tex with aux in build / custom), default
recipe, and settings.json link; the per-recipe editor has steps, toggle chips with
explanations for tool arguments, locked chips for managed arguments, and a %TAG% glossary.
Logic lives in src/shared/recipe-help.ts (unit tested). Not run natively. Someone else is
migrating lucide to Phosphor via src/renderer/src/icons.tsx; added Hammer, Palette, Wrench,
Undo2 there. VM typecheck reports missing Phosphor types (node_modules not installed here).

2026-10-18 PDF jitter fixes (working tree): page renders to an off-screen canvas and swaps
in one step (resizing the visible canvas cleared it); fit-width resize is debounced 120ms and
the scroll area reserves its scrollbar (scrollbar-gutter) to avoid width feedback loops;
scroll position scales with page height on re-fit; recompiling keeps the old document on
screen until the new one loads (no canvas unmount); search highlights are computed in a
separate effect so searching no longer re-renders the bitmap. Not verified natively.

2026-10-18 Folding icon fix (working tree): the box glyph came from the minimal Monaco
entry omitting codicon.css (icon font), which also affects find/suggest widget icons. The
font CSS is now imported by relative node_modules path (package exports cannot address
.css) and fold controls are drawn as small +/- masks in styles.css, shown on gutter hover
when open and always when folded. Not verified natively.

2026-10-18 Round 4 (working tree): explorer folders now start collapsed (expandedFolders
set; opening a file or reveal-active expands its ancestors). Folding was still dead after
the contribution imports because deep monaco imports were not in Vite optimizeDeps.include,
so they loaded as separate raw modules whose registrations the pre-bundled editor never
sees; all Monaco entry points are now listed. e2e asserts folding icons exist and nested
files are hidden at start. Not run natively: restart npm run dev fully to rebuild the cache.

2026-10-18 Explorer/editor round 3 (working tree): root cause of dead folding was the
minimal Monaco entry (editor.api.js) lacking the folding, bracketMatching and comment
contributions; they are now imported. Sidebar is resizable (persisted sidebarWidth
160-480, drag/arrow keys/double-click reset). All sidebar icon buttons have tooltips.
Context menu reads Open in File Explorer / Open in VS Code. New file/folder create
inline in the tree beside the selection (Enter creates, Esc/blur cancels, names only).
Owner decision: explorer shows literally everything (build/, .git, .textra, aux files);
validateRelativePath no longer blocks protected names, so rename/delete work on them
(delete uses the OS trash, with confirmation). .git and node_modules are listed but not
walked so the 10,000-entry limit cannot hide real files. Compile still refuses
.git/.textra/node_modules roots in latex.ts. Not run natively; if folding is still
absent, check Vite dev-server re-optimization of the new monaco deep imports.

2026-10-18 Explorer/editor fixes (working tree): file clicks no longer open the actions
menu; it opens on right click, Shift+F10/Menu key, or the "..." button on the selected
row. Project name header is an inert label; rows are flush left with 14px per folder
level. Folding now uses a LaTeX FoldingRangeProvider (environments, sectioning, comment
runs; features/editor/folding.ts) because Monaco's default indentation folding cannot
fold unindented LaTeX. Folding logic was run directly on fixtures in a Linux VM; UI
behavior still needs a native check.

2026-10-18 Phase 1 completion slice (working tree, uncommitted): explorer subfolders
collapse with chevrons and open/closed icons (root has no chevron); Copy Path and Copy
Relative Path in the context menu (handler moved to its own IPC registration);
reveal-active button; window-focus project refresh; Monaco folding and LaTeX theme;
font size and word wrap persisted in preferences; custom executable paths per TeX tool
(absolute path whose file name must match the tool, stale override reports not found);
PDF search highlights with previous/next match; shared inset selection styling.
Owner decisions: TeX install help moved to Phase 4; TEX root unsupported. Verified in a
Linux VM: typecheck, lint, format; preference validation logic run directly. Vitest,
build and native Electron checks could not run there (Windows native binaries) and
must be run on Windows: npm test, npm run build, npm run test:e2e.

2026-10-18 Project recipes checkpoint: canonical .textra/settings.json is generated
on explicit folder/recent open, safely migrates legacy project.json without deletion,
accepts JSONC, and preserves invalid/future files. Popup builder and JSON view edit
defaults/new named recipes, ordered tools, output/aux paths, SyncTeX and project
default. Same Workshop recipe/tool keys and documented placeholders; commands,
flags, env and paths remain allowlisted. Compile loads disk settings afresh, saves
per-document selection only when changed, and avoids unnecessary comment rewrites.
Expected snapshots prevent stale popup overwrite; bounded Windows lock retries keep
rechecking paths/conflicts. Explorer clicks are disabled during async project changes.
Configured outputs default to build/textra/%RELATIVE_DOC%; never auto-pruned. Direct
MiKTeX supports separate aux; latexmk/TeX Live require aux=out. Stable PDF outputs
carry pdfVersion so the viewer reloads bytes; failed sidecar mapping is disabled.
Verified 179 tests in 16 files, all three native workflows, typecheck, lint, format,
production build. Native includes builder/JSON/external edits, stale save conflict,
same-path PDF text refresh and existing no-data-loss workflows. docs/RECIPES.md and
recipe-builder.png document compatibility and limits. Full Phase 1 remains open for
installer/manager, custom executable paths, explorer folder collapse/reveal-active,
persisted font/wrap and wider platform/PDF validation. Earlier UI follow-ups are
included in this checkpoint; sandbox/.textra remains untracked manual project data.

2026-10-18 Empty-state follow-up (working tree): Recent Projects now uses a native
keyboard-accessible details/summary disclosure, collapsed by default and anchored
at the explorer bottom. Its expanded list scrolls independently. Replaced the large
welcome copy with a 22px heading, one sentence and one action; PDF empty state is
also smaller and concise. Typecheck/lint/format pass; production build and native
shell smoke pass after retrying a transient Windows output-directory lock. Native
empty-state screenshot visually reviewed.

2026-10-18 Tab styling follow-up (working tree): source file tabs are inset 28px
rounded rectangles with a filled active state and transparent inactive state. Removed
full-height tab dividers/active underline. Inactive close controls appear on hover or
keyboard focus; dirty indicators and focus outlines remain. Production build and
native project workflow pass; screenshot visually reviewed and updated.

2026-10-18 Activity rail follow-up (working tree): added Files icon for File Explorer
and Blocks icon for Extensions. Explorer opens the existing project tree; Extensions
opens a clearly labeled future-extension placeholder. Active view is highlighted;
collapse and Settings remain separate. Sidebar view switches preserve documents and
dismiss file menus. Typecheck, lint, formatting, build and native shell smoke pass.

2026-10-18 Compact controls follow-up (working tree): Compile/recipe, Preview,
Problems, Output and collapse now share one compact row. Removed explorer bottom
action bar. Left-clicking an entry opens an accessible action menu (files also open
in editor); right-click/Shift+F10 work too. Rename/Delete keep existing save and
confirmation protections; Reveal/VS Code retain narrow bridge actions. Native
workflow passes with menu/rename-cancel checks and measured toolbar alignment;
typecheck, lint, formatting and build pass. Screenshot updated.

2026-10-18 Workspace layout follow-up (working tree): removed app header/footer and
PDF footnote. Left activity rail provides sidebar collapse, commands and bottom
Settings; theme selection is inside Settings. Compile/recipe/cancel now live in
Preview pane with Preview/Problems/Output tabs. Builds do not switch views or reveal
logs. Preview collapses sideways, expands editor and preserves mounted PDF state;
previewVisible is persisted with legacy preference migration. PDF search is hidden
until scoped Ctrl/Cmd+F; Escape closes. Ctrl/Cmd+H routes to source replace, with
Monaco find contribution explicitly loaded. Verified 116 focused tests, typecheck,
lint/format/build, shell persistence and native project workflow including PDF
search/replace, collapse, tab selection, real compile and settings-failure handling.
README and docs/screenshot.png reflect current UI. Existing untracked sandbox
project settings remain preserved.

2026-10-18 Compile follow-up (working tree): renderer fills missing recipe defaults
from older loaded preferences. Compile no longer disables on tool discovery results;
it attempts the selected allowlisted compiler and exposes errors. Optional recipe
persistence failures warn without preventing compilation. Disabled states explain
missing active .tex/current file operation and use not-allowed rather than wait.
Verified 24 focused tests, typecheck/lint/format/build and the native project workflow
with legacy preferences and an injected recipe-save failure. Sandbox project settings
created during manual testing are preserved as untracked user data.

2026-10-18 UI refinement checkpoint: removed the build toolbar row. A top-bar
Compile split button builds only the active .tex tab; recipe choices persist per
document in .textra/project.json on compile. Settings provides the portable default
recipe; old preferences and explicit root/engine settings remain readable. Open
folder is an explorer icon. Verified 65 focused tests, native project workflow
(including active-tab target, recipe restoration and new-document default), lint,
typecheck and production build. User sandbox/test.tex is preserved.

2026-10-18: Foundation complete; core Phase 1 workflow implemented. Full Phase 1
is incomplete. Last passing implementation commit: ea4c1ef (core IDE).
Foundation commit: 345fb44. All implementation and verification are committed.

Working: selected local roots, bounded explorer, UTF8 Monaco tabs/undo, safe saves,
create/rename/trash, recent/pinned projects, file-manager/VSCode actions, revision
conflicts, unsaved close/switch checks, TeX discovery, fixed presets, real bounded
cancellable builds, diagnostics, PDF.js pages/zoom/search, two-way SyncTeX including
chapters, settings import/export, project overrides and setup test compile.
No AI/network source sharing. See KNOWN_ISSUES for remaining features/limitations.

Evidence: typecheck/lint/build pass; 138 tests in 12 files pass including real
MiKTeX/BibTeX/latexmk/SyncTeX and filesystem junctions. Expanded native workflow
passes editing/conflicts/five-page PDF/settings/setup/unsaved-discard/reopen.
Final shell/reload checks passed, along with format/typecheck/lint/build/diff checks.

Next three actions:

1. Finish Phase 1 editable allowlisted pipelines and distribution install/manager
   workflows with current metadata and explicit in-app user confirmation.
2. Persist font/wrap, add context menus/collapsible tree/reveal-active and TEX-root
   hints; validate additional engines and PDF crop/rotation/zoom navigation.
3. Complete full Phase 1 acceptance matrix before proceeding to Phase 2.

2026-10-19 Editor formatting toolbar: a compact, default-visible toolbar now sits
above LaTeX source tabs. It provides bold, italic, numbered and bulleted lists,
figure, table, and section-level commands. Text selections are wrapped for inline
commands; environment commands insert an empty structure with one list item where
appropriate and retain the selected text. Insertions are single Monaco undoable
edits and place the caret at the first useful editing position. The editor's
ellipsis menu persists a Formatting bar shown/hidden preference. Typecheck, lint,
targeted format check, and production build pass. The global format check reports
only the pre-existing untracked `.vitest/json/output.json`. User sandbox/test.tex
and sandbox/.textra remain user-owned changes.

Launch: `npm run dev`. Checks: format:check, typecheck, lint, test, build,
test:e2e, test:dev. Desktop permissions may be needed for sandbox-blocked output
cleanup/junction tests. No installers, signing or cross-OS behavior verified.

2026-10-18 Sidebar identity follow-up (working tree): Lucide replaced by Phosphor via
src/renderer/src/icons.tsx. Extensions placeholder removed. New Document sidebar view
(features/document/DocumentView.tsx) shows the active .tex file's outline with included
chapters spliced in, and a tree of used files with missing/circular markers; parsing
lives in src/shared/tex-structure.ts and document-model.ts (tests/unit/tex-structure.test.ts).
Sidebar headings are serif sentence case; selection is pill shaped. Not yet verified in
the native window; package-lock.json needs `npm install` on Windows after the dependency swap.

2026-10-18 Pill language and Document view layout (working tree): tabs, compile control,
preview tabs, toolbar/PDF controls, icon buttons and menu rows share --radius-pill; menus and
popovers use --radius-surface (styles.css :root). Document view sections are collapsible, the
Outline/Files used boundary is a keyboard-accessible splitter, and Files used defaults to a
150px pane at the bottom; layout persists in localStorage (textra.documentView). electron.vite
config now pre-bundles @phosphor-icons/react instead of lucide-react. Checked in headless
Chromium against the production renderer build with a stubbed window.textra (not Electron).

2026-10-18 Full-width preview (working tree): preview header has an Expand/Restore button
and the palette has Toggle full-width preview. State is session-only (useUI.previewExpanded,
not a saved preference). The editor pane is hidden, not unmounted, so Monaco state survives.
Opening a file or jumping to a source line (explorer, problems, PDF double-click) restores the
split. Not visually verified: the renderer build in the Linux shell currently fails with EMFILE
on material-icon-theme's SVG glob. Typecheck and lint pass.

2026-10-19 Expand panes (working tree): useUI.expandedPane ('editor' | 'preview' | null,
session-only) replaces previewExpanded. Editor tab actions and the preview header each have a
diagonal-arrows (Phosphor ArrowsOutSimple/ArrowsInSimple) expand/restore button; the palette has
Toggle full-width editor and Toggle full-width preview. Expanding the editor hides the preview
pane (Ctrl+Enter still compiles); closing the last tab restores the split. Verified in headless
Chromium against a production build (state transitions and screenshots). To build in the Linux
shell, use a local copy of src with node_modules/material-icon-theme copied locally, since the
mount hits EMFILE on that package's SVG glob.

- Collapsed preview pane now shows a quick-access rail: expand, green compile/cancel circle, severity-colored alert (opens Problems), log icon (opens Output). The "Expand editor" button is commented out in Workspace.tsx; its state, palette command and effects are kept for a later decision.
