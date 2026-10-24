# Electron architecture audit and implementation

The 2026-10-24 refactor preserves the sandboxed renderer and narrow preload bridge.
Its priority is filesystem containment, document preservation, and resources with
explicit owners. No new dependencies, automatic provider calls, or general-purpose
process/IPC capabilities were introduced.

## Findings and changes

| Priority | Confirmed defect                                                                                  | Implemented correction                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | A crafted history index or history junction could redirect automatic pruning outside the project. | One canonical storage resolver validates ancestors, regular files, persisted paths and records before reads, writes and deletion. Symlinks, junctions and hardlinks are rejected. |
| High     | History restore discarded the unsaved editor buffer and continued after backup failure.           | Main must durably snapshot captured editor text and differing disk text before revision-checked restoration. The renderer preserves intervening edits.                            |
| Medium   | History used a fresh project-session UUID and disappeared on reopening.                           | History always lives in portable `.textra/history`. Legacy app-data stores remain available through explicit reviewed recovery.                                                   |
| Medium   | Invalid catalogs became empty catalogs and were overwritten.                                      | Only absence means empty history; malformed, future-version and inaccessible catalogs are preserved and reported.                                                                 |
| Medium   | Formatting changed store text while the active Monaco model remained stale.                       | Versioned document sessions reconcile owned model attachments through undoable replacement and reject stale previews.                                                             |
| Medium   | Concurrent saves reused one revision and created false external conflicts.                        | Saves coalesce by project/path and recapture current text and revision between writes.                                                                                            |
| Medium   | Immediate settings export could capture the previous debounced preference value.                  | Import and export await pending preference writes before reading or replacing settings.                                                                                           |
| Medium   | Files growing after stat could produce truncated text/settings reads or exceed the PDF cap.       | Bounded reads continue to actual EOF and reject data beyond existing limits.                                                                                                      |
| Medium   | History failure logs included the entire document save request.                                   | History diagnostics contain selected event/error codes, never source or raw storage errors.                                                                                       |
| Medium   | Concurrent watch registration and delayed samples leaked timers or emitted stale events.          | Generation-scoped registrations dispose superseded resources and recheck ownership after awaits.                                                                                  |
| Medium   | Language subprocess stream errors could escape main; output/concurrency were unbounded.           | Owned processes handle every stream, cap bytes, support cancellation and deadlines, and terminate/drain process trees.                                                            |
| Medium   | TexLab accepted unlimited incomplete headers and ignored outbound backpressure.                   | Incremental framing enforces header/body limits; a bounded outbound queue waits for drain and owns stream errors.                                                                 |

Integration regressions also cover local history restores notifying their watcher,
workspace-scoped AI cancellation, delayed resource starts after cancellation,
preference writes during project transitions, and a final authoritative dirty-state
acknowledgement before the native close decision.

The legacy duplicate Save/Compile keyboard listener also bypassed configured key
remappings. The central shortcut dispatcher now exclusively owns those actions.

The filesystem trust boundary is enforced in
[`HistoryStorage`](../src/main/services/history-storage.ts) and
[`HistoryService`](../src/main/services/history.ts), including persisted catalog input.
Document-preservation fixes live in
[`document-sessions.ts`](../src/renderer/src/state/document-sessions.ts),
[`document-actions.ts`](../src/renderer/src/state/document-actions.ts) and
[`workspace.ts`](../src/renderer/src/state/workspace.ts).
Resource ownership is implemented in
[`owned-process.ts`](../src/main/services/owned-process.ts),
[`external-editor.ts`](../src/main/services/external-editor.ts) and
[`texlab.ts`](../src/main/services/texlab.ts).
These are confirmed defects corrected by this refactor; the platform and performance
work listed below remains verification work.

## Ownership and contracts

- `main/index.ts` acquires the profile lock before service initialization. Subsequent
  launches focus the existing window; a windowless primary can recreate it.
- `main/application.ts` composes services. `main/window.ts` owns window policy,
  `main/ipc.ts` registers fixed capabilities, and `main/lifecycle.ts` owns admission,
  transitions, app-scoped tasks, and single-flight shutdown.
- Workspace transitions invalidate resource generations, cancel/drain requests,
  then replace the root token. App-scoped preference writes remain available.
  Chat and other mounted persistence owners flush before retiring a project token.
- Renderer document sessions own buffer versions, model attachments, save queues
  and accepted replacements. React renders snapshots and issues explicit commands.
- File-history listings use cursors (100 entries by default, maximum 200). Restore
  includes captured recovery text. Legacy recovery accepts only enumerated UUID
  IDs and requires native confirmation; it never guesses project identity or
  deletes original stores.
- Lint/format requests have scoped IDs and cancellation. Each workspace permits
  one lint and one format job; lint supersedes older work. Output limits are 5 MiB
  stdout and 256 KiB stderr, with the existing 15-second deadline.
- Close waits for renderer persistence, the current dirty bit, native discard
  confirmation when needed, resource cleanup and persistence queues. Failed
  persistence keeps the window open. A known renderer crash/load failure requires
  explicit native consent before closing without its acknowledgement.

Existing sandbox/context isolation, sender/frame/origin checks, compiler allowlists,
shell-escape restrictions, explicit AI consent, provider destination guards and
Monaco/PDF cleanup remain in force. Portable history is plaintext project content
and follows the project's sync/backup policy.

## Verification and remaining limits

The final Windows gate passed 704 unit/integration tests (67 files), all 15 native
functional tests, typecheck, lint, production build and the development HMR/preload/
main restart smoke test. The full native run took 4.1 minutes; live AI and the
separately invoked benchmark were intentionally skipped in that run.

Verification commands and run-specific results are recorded in
[Testing](TESTING.md) and `.agents/memory/TESTING.md`. Targeted regressions include
hostile persisted indexes, real Windows links/junctions, backup failure, interrupted
import, growth after stat, stale document versions, overlapping saves, watcher races,
stream errors, framing/backpressure, shutdown and native Monaco undo/save behavior.

Native tests use disposable profiles. Provider calls are fixture servers or explicit
mocks; no live-provider quality, quota or latency claim follows from those tests.
Startup measurements distinguish launch observations, renderer marks, process
counters and main event-loop samples; see [Performance](PERFORMANCE.md).

Cross-platform native verification, installer/release checks, and genuinely cold
packaged desktop startup remain open. Portable Node path validation narrows but
cannot eliminate hostile concurrent filesystem TOCTOU races. Interrupted history
publication can preserve unindexed snapshot bytes; originals are never removed by
legacy import. TeX execution remains allowlisted but is not an OS-level sandbox.
