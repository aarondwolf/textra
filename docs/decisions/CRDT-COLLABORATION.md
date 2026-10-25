# Decision: local-first Yjs collaboration for `.tex` files

Date: 2026-10-25

## Choice

- Use Yjs 13.x for document state, update encoding/application, state vectors,
  and `Y.UndoManager`; use `y-monaco` for the editor binding.
- Add `y-protocols` explicitly because `y-monaco` 0.1.6 imports its `Awareness`
  type at runtime without declaring the dependency. Alias its legacy Monaco import
  to the package export already used by TeXtra.
- Keep unmatched plain-file edits in manual review. `node-diff3` was evaluated as
  a suitable region-producing merge library, but this slice does not yet have a
  reliable thin translation from its accepted edits into Yjs operations.
- Keep Chokidar as the filesystem change detector and extend the existing guarded
  save and History services. The renderer owns live editor bindings; main owns
  project storage, validation, atomic writes, and shutdown draining.
- Store per-device conflict policy in app-local state. Keep portable immutable
  collaboration records beneath `.textra/crdt`, with create-only unique records
  and a small folder transport adapter. The records are ordinary portable project
  data; the live database and outbox are never placed in a Dropbox-synchronized
  database file.

## Provider assessment

Yjs documents it as network agnostic and lists database and network providers.
`y-indexeddb` is suitable for browser-profile-local persistence, but it cannot
exchange updates between two isolated Electron profiles or copied project folders.
LevelDB and server providers add an unsuitable live database or service. The
existing project folder is the required transport, so a thin immutable-record
adapter is needed; it uses Yjs `encodeStateAsUpdate` / `applyUpdate` and does not
reimplement CRDT ordering, reconciliation, or causal semantics. No awareness or
network provider is included.

## Plain-file merge assessment

`node-diff3` is MIT-licensed, ships ESM and CJS, and exposes structured `ok` and
`conflict` regions through `diff3Merge`. It was evaluated for line-preserving
inputs and overlap detection; `merge()`'s marker output would not be used. The
dependency is deferred until conflict-free regions can be translated into Yjs
operations using a thin adapter and a captured baseline. No custom diff3
algorithm or distributed reconciliation subsystem will be built.

## Deliberately deferred

- Network collaboration, presence, remote cursors, live database synchronization,
  automatic compaction, recovery-retention controls, and formats beyond `.tex`.
- Plain-file auto-merge; all external plain-file edits currently require manual
  review.
- Recovery metadata editing and a custom distributed history catalog.

## Limits

Encoded updates are capped at 16 MiB; portable collaboration storage is capped at
128 MiB and 10,000 records per document; visible text retains the existing 5 MiB
limit. Invalid or incompatible records are preserved for review. Mandatory
pre-merge recovery snapshots remain active even when optional History snapshots
are disabled.
