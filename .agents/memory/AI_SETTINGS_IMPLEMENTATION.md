# AI settings and inline-edit implementation tally

Status: COMPLETE. Verified implementation is saved in the local milestone commit. Owner: root coordinator.
Approved plan: 2026-10-21 chat. Keep user sandbox/test.tex changes; do not push.

## Completed

- [x] Provider configuration v4: atomic migration, encrypted keys/defaults/catalogues preserved.
- [x] Offline Add/Edit Provider, compact configured rows, explicit Test/Refresh and confirmed Delete.
- [x] Silencing retains configuration and blocks SDK initialization, key decryption, pings and inference.
- [x] Validated configurable endpoints; endpoint changes invalidate catalogue and sharing consent.
- [x] Independent exact-ID All/Include/Exclude model visibility, searchable lists, counts and resets.
- [x] One custom OpenAI-compatible connection with optional key/manual model IDs; tool support opt-in.
- [x] Standard Mistral connection handles Codestral FIM; obsolete dedicated connection removed.
- [x] Chat/Agent/Ctrl+I defaults in one compact card; automatic selector shown only while enabled.
- [x] Prompted Ctrl+I insertion and selected-range replacement with preview, guarded acceptance and Undo.
- [x] Automatic completion shows ghost text only; health and Retry live in Settings.
- [x] Ctrl/Cmd+Enter compiles once without inserting a newline.
- [x] Unit/static/build/native verification; live evidence separated below.
- [x] Documentation/memory updated. Native Monaco retained; no monacopilot dependency.
- [x] Local milestone commit and final handoff; no push.

## Interfaces and defaults

- Narrow configureAIProvider, requestAIInlineEdit and cancelAIInlineEdit APIs.
- Inline edit: instruction 4,000; selection 16,000; prefix 16,000 / suffix 4,000 / metadata 4,000 characters.
- Output 4,096 tokens/32,000 characters; sixty-second deadline; no tools or project traversal.
- Automatic: 1–10 lines/384 tokens, thirty seconds local/ten seconds remote, unchanged opt-in.
- Hidden/silenced/missing model bindings stay visible and blocked. No silent rerouting.
- Custom transport: standard /models and /chat/completions; Agent requires explicit tool support.
- Mistral default https://api.mistral.ai/v1; FIM POST /fim/completions.
- HTTP allowed only for explicit private/loopback addresses, with unencrypted-connection notice.

## Verified evidence

- npm run typecheck and npm run lint: pass. Changed-file formatting and whitespace checks pass.
- Whole-repository format:check still warns only for unchanged docs/ROADMAP.md and sandbox/issues.md.
- npm test -- --maxWorkers=1: 557/557, 43 files, 98.40s.
- Final provider/backend focused tests: 149/149; editor tests: 17/17.
- npm run build: passes normally (final build 6.70s).
- Native serial matrix 7/7 in 4.3m: Agent, Chat, completion, word selection, custom settings, shell, UI consistency.
- Final custom-provider reset/count controls retest: passes in 31.4s (32.9s total).
- Native tests use real Monaco/preload/project IO, explicit mocked AI/build boundaries.
- Native editor proves prompt focus/typing, no send before submit, selected diff click Accept,
  insertion ghost Tab, one-step Undo, stale cancellation, quiet prose, equation/literal automatic
  completion and Ctrl+Enter exactly once.
- Live local Qwen2.5-Coder3B prompted edit through chat: passes in 21.594s, 16 characters/one line, identity matches.
- Live local Qwen3B native FIM: passes in 3.592s, five characters/one line, identity matches.
- Live Mistral FIM and Google prompted-edit probes attempted: blocked before requests because their
  encrypted keys cannot decrypt in the isolated test profile. Keys were preserved. Mocked wire
  contracts pass; this is not evidence the keys are invalid in the normal desktop session.

## Remaining follow-up

1. No implementation work remains for this slice. User sandbox/test.tex stays uncommitted.
2. Optional live acceptance from the owner's normal desktop profile: Mistral/Codestral FIM
   and Google Ctrl+I. Do not replace keys/defaults or copy credentials into test profiles.
3. Existing cross-platform/installer/phase gates remain incomplete in docs/ROADMAP.md.

Launch from repository root: npm run dev. Restart for main/preload changes.

## Resolved integration findings

- Monaco view zones were aria-hidden and focused before paint. The interactive zone now
  exposes its form, waits for measured layout before focus and restores attributes on close.
- Monaco source lines intercepted prompt buttons. Interactive zone stacking now keeps controls clickable.
- Same-buffer autosave no longer invalidates source-version-identical suggestions.
- Provider endpoint changes clear discovered catalogues; silence/filter changes cancel only affected work.
- The exact preload API inventory test includes the three narrow additions.
