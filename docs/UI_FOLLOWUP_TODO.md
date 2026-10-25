# UI Follow-up To-do

Track and verify the requested UI fixes. Blank categories are intentionally clean.

## General UI

- [x] Find and migrate remaining native/default tooltips in Problems, the
      editor formatting toolbar, resizers, and renderer title-bar controls to
      the shared styled Radix tooltip.
- [x] Make custom renderer title-bar controls use the shared tooltip. Electron's
      OS-rendered minimize/maximize/close controls cannot be dimmed or have their
      tooltip surface themed from renderer CSS; that native limitation remains.
- [x] Create one shared “Add” button using TeXtra's Button component, subdued
      treatment and dashed border; migrate recipe, snippet, provider, and step
      add actions.

## History & Projects

- [x] Remove the “Recover earlier history…” explanatory text block and its now
      unreachable recovery prompt UI.
- [x] Create one shared Radix collapsible section header for Writing, History,
      Recent Projects, and Snippets & Symbols (chevron, icon, title, optional
      detail/count) and migrate the matching sections.

## Settings

- [x] Put each AI provider’s enable switch before its provider name.
- [x] Keep API-key paste masked using the standard password input behavior and
      ensure key values never appear in UI text or logs.

## Build

- [x] Use the shared dropdown in recipe Steps for selecting a tool (already
      shared; verified the active controls).
- [x] Reuse the Preview pane’s compile/recipe control in the Build tab and verify
      the control is not clipped.

## Snippets & Symbols

- [x] Replace the cards with shared collapsible sections.
- [x] Style Snippets sections like the Writing and History disclosure rows.

## Assistant

- [x] Reduce the recent-chat title typography to match its surrounding metadata.

## Editor

- [x] Enable “View Markdown” for Markdown documents and switch to the Markdown
      preview.
- [x] Allow Save As for every supported text document type, including Markdown.
- [x] Make the Insert Heading selector wide enough to show “Heading”, then
      collapse to “H” or move the formatting controls into an overflow menu when
      the editor pane is narrow. The trigger has a compact, truncating width and
      the toolbar remains horizontally scrollable at narrow widths.
- [x] Add consistent spacing between the font-size dropdown and word-wrap
      control and cover the gap and shared tooltip with native UI assertions.

## Validation

- [x] Run formatting, typecheck, lint, relevant unit/integration tests, build,
      and native UI tests; inspect the affected views at wide and narrow widths.
- [x] Update `.agents/memory/CURRENT_STATE.md` with evidence and any limitations.
