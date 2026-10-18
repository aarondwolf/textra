# TeXtra agent guide

## Mission and priorities

Build a local-first LaTeX desktop IDE. Prioritize correctness, data preservation,
security, and fast development over demos. `docs/FEATURE_SPEC.md` is the product specification.

## First actions in every session

Read README, docs/ROADMAP.md, docs/ARCHITECTURE.md, docs/SECURITY.md, and
.agents/memory/CURRENT_STATE.md. Inspect Git status, run basic validation, and
identify the next unfinished phase gate. Preserve existing user changes.

## Architecture boundaries

Electron main owns OS, files, processes, and future keychain operations. Preload
exposes only typed narrow APIs from src/shared/api.ts. Renderer owns UI and editor
interactions. Services never import React. AI adapters must be replaceable and
optional. Projects remain ordinary portable LaTeX files.

## Development commands and verification

Node 24 LTS and npm 11 are the initial Windows toolchain. Use `npm ci`, `npm run dev`,
`npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`,
`npm run build`, and `npm run test:e2e`. The native-window smoke test is the minimum
integration check. See docs/TESTING.md for current evidence and prerequisites.

## Coding standards

Strict TypeScript; no silent any. Typed IPC with runtime validation in main,
readable components, minimal dependencies, accessible controls, atomic writes,
conflict detection, and APIs verified against installed declarations/docs.

## Security rules

No renderer Node access or arbitrary IPC/process commands. Sandbox and context
isolation stay enabled. No credentials in logs or exports. Network/AI context
sharing requires explicit user action. No execution of AI-proposed commands.
Build tools are allowlisted; shell escape stays disabled. Canonicalize paths and
reject traversal and symlink escapes. Confirm destructive actions.

## Testing and acceptance

Complete phase gates in order. Use real fixtures and integration tests; label
mocks and skipped external integrations honestly. Validate before milestone
commits; do not commit artifacts/secrets or push without authorization.

## Agent coordination

Parallel work is authorized by the build specification. Delegate bounded modules
with explicit contracts and exclusive file ownership. Coordinator reviews,
integrates, runs full checks, updates memory, and commits. Never overlap edits.

## Memory protocol

Read relevant CURRENT_STATE, ARCHITECTURE, DECISIONS, and KNOWN_ISSUES before a
task/handoff. Update factual status, interface decisions, evidence, and next steps
after a slice. See .agents/memory/README.md. Never store secrets or private content.

## Definition of done and reporting

Functionality tested, documentation current, no known critical failures, Git clean
or exceptions explained, exact launch command and next steps recorded. Partial
phases must remain explicitly incomplete.
