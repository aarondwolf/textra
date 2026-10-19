# Handoff prompt for a new agent

You are continuing work on TeXtra, an Electron + React 19 + zustand LaTeX IDE (Monaco editor, pdfjs preview). Read CURRENT_STATE.md, DECISIONS.md and docs/ROADMAP.md first. Aaron wants it to look distinct from VS Code and cares about a clean TeX-only product (Git is Phase 3, later).

## What changed in the recent UI pass

- Icons: Phosphor, all imported through src/renderer/src/icons.tsx (aliases keep old Lucide names). Add new icons there.
- Sidebar: Explorer, Document (section outline with included files spliced in, plus a "files used" tree), Equations, Snippets. Extensions placeholder removed. Clicking the active rail icon collapses the sidebar. A segmented-control replacement of the rail is pinned in docs/ROADMAP.md, not built.
- Design language: pill shapes for tabs, compile, preview tabs and controls; serif sentence-case sidebar headings; tokens in styles.css (--radius-pill, --accent, --accent-bg, --alert-error, --alert-warn).
- Preview pane: can expand to full width (session-only expandedPane in state/ui.ts). The Expand-editor button is commented out in Workspace.tsx (the "Collapse right pane" option covers it); its state, palette command and effects are kept for a later keep-or-delete decision.
- Collapsed preview rail (36px): Expand, round Compile/Cancel button in the theme accent fill, PDF preview, severity-colored Problems triangle (muted red for errors, muted ochre for warnings, plain with a small check badge when clean, plain before any build), and Output log. Each opens the pane on that tab; Compile builds without opening it.
- Responsive preview header: the Preview/Problems/Output tabs show labels, then icons, then fold into the preview "..." menu as the pane narrows (ResizeObserver on .preview-tabs-host, thresholds in Workspace.tsx). In menu mode the PDF page and zoom controls render inside the same menu via a portal (PdfViewer menuSlot/menuMode). Expand and copy buttons hide under 240px via a container query. The floor is about the Compile button plus Collapse.

## Known issues and tips

- package-lock.json is not synced; Aaron must run npm install on Windows. Phosphor installs can be left partial by the Linux shell; re-copy from an npm pack of @phosphor-icons/react if TS7016 or TS2305 appears.
- ui.ts has a small save race where a preference change arriving as a save finishes can go unsaved.
- Checks: npx tsc --noEmit, npx eslint, npx prettier, vitest from a local copy (the Dropbox mount breaks its cache). Visual checks use an electron-vite renderer build and headless Chromium with a stubbed window.textra.
- Dropbox on Windows: edit files via the device shell, not the cloud Write tool. Do not use em-dashes in anything written for Aaron.
- The latest responsive-menu change was typechecked and linted but not yet re-verified visually.
