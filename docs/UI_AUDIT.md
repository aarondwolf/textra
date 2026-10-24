# UI Controls Audit

Date: 2026-10-24

## Scope

Audited the workspace shell, file and tab actions, preview/PDF controls, compile
recipe selection, history actions, chat history, model picker, formatting toolbar,
Settings, AI provider controls, and recipe/setup dialogs. The Radix implementation
continues to use the installed Radix UI packages and `cmdk` for model navigation.

## Repairs

- Centralized nested dialog, menu, and popover stacking in
  `src/renderer/src/components/overlay-layers.tsx`; portals stay visible above
  their parent modal and remain hit-testable.
- Kept the compile and recipe buttons in one inline control group. The recipe
  trigger is now the actual button rendered as Radix's `asChild` target, so Radix
  receives its focus, keyboard, and pointer handlers.
- Used Radix radio menu items for single-choice dropdowns and ordinary menu items
  for actions. Theme, engine, recipe, and model selections expose selected state
  accessibly.
- Replaced the preview selector's mixed menu/footer content with a Radix popover
  containing view buttons and PDF controls.
- Migrated chat history actions to Radix dropdown behavior and the model picker to
  Radix Popover plus `cmdk`, including provider/model identity and search focus.
- Updated menu and popover theme styling and removed legacy absolute placement that
  conflicted with Radix collision-aware positioning.
- Added a shared Radix tooltip provider/trigger and help tooltip component with
  TeXtra surface styling; icon and dropdown-menu triggers with help text use it.
- Aligned history and recent-project headings and counts; documented the legacy
  history recovery path and clarified its source/merge behavior.
- Harmonized Appearance, Editor, Files, and Compilation controls. Added global
  user recipes that can be imported into project recipes while project settings
  remain portable. Updated AI settings labels.
- Reworked the editor toolbar actions and disabled Save when the active document
  is clean, busy, or in conflict. Compact layouts horizontally scroll the toolbar
  within the editor boundary instead of drawing over the preview.
- Simplified assistant history rows and added editable conversation titles.

## Evidence

- `tests/e2e/radix-controls.spec.ts` runs the native Electron app with an isolated
  user profile and fixture project. It checks compile/recipe alignment, selected
  recipe state, Escape dismissal, Settings menu hit-testing and theme changes, and
  preview switching at a compact width. It captures wide, compact, light-theme,
  Settings-menu, and preview-menu screenshots under Playwright's test-results output.
- The Radix UI test also verifies styled tooltip content, radio controls, recipe
  step edits/default selection, and saving a global recipe. It captures Appearance,
  Editor, Files, Shortcuts, LaTeX tools, Compilation, AI, Import & export, workspace,
  and compact preview screenshots; the AI screenshot waits for its asynchronous
  Settings panel to render.
- `tests/e2e/chat.spec.ts` captures the open model picker and chat history menu;
  both were visually inspected after the Radix migration.
- Full native Playwright suite after final changes: 16 passed, 2 skipped. The skips are the opt-in live
  provider test and optional startup measurement; no live provider request was sent.
- `npm run test:dev` passed native startup, Settings interaction, CSS HMR without
  page reload, preload reload, and main-process restart with saved theme restoration.
- Unit/integration tests: 71 files and 728 tests passed. Typecheck, lint, format
  check, and production build passed.
- Visual inspection also covered the provider editor, recipe builder, symbols view,
  chat model picker/history, workspace shell, rendered PDF workspace, and inline
  completion view. No other reproducible visual defects were found. The model ID
  truncates in the narrow picker row while its full model name remains visible and
  accessible; this is expected in the current responsive width.
- The 2160×1410 wide screenshot, 900×640 compact screenshot, dark/light Settings,
  theme menu, compact preview menu, and chat views showed the compile controls on
  one row, legible menu contrast, and correctly layered overlays. The 2160×1410
  captures are the native 1440×940 window at display scale.
- Visual review of the Settings Editor, Files, Compilation, Shortcuts, LaTeX tools,
  AI Settings and Import & export views found no further reproducible defects. No
  LaTeX logo asset was present to use for the LaTeX tools icon.

The screenshots are generated test artifacts rather than checked-in product
assets. Recreate them with `npm run test:e2e -- tests/e2e/radix-controls.spec.ts`.

## Build-host note

On this Windows/Dropbox checkout, clearing the generated `out/renderer/assets`
reparse point can fail with `EPERM`. The verified build used
`$env:TEXTRA_PRESERVE_RENDERER_OUTPUT = 'true'; npm run build`; the default build
still cleans its output normally. This is a host filesystem limitation, not an
application UI failure.
