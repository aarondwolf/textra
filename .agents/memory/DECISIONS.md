# Decisions

- 2026-10-21 observed CPU Qwen behavior revises local completion timing: remote
  2.5/15s stays, local-only Ollama gets 10/30s and shorter contiguous context.
  Automatic local insertion stops after its first useful line (up to three with
  leading newlines); manual can span twenty. A distinctive echoed suffix stops
  native generation before model explanation/EOS. No model or provider fallback.
  TexLab repeated source sync is idempotent; stale/cancelled work must not produce
  warning storms. Explicit document closure resets client version epochs.

- 2026-10-21 completion: AIRole chat/agent/completion/inlineCompletion means Chat,
  Agent, automatic and Ctrl+I respectively. v3 replaces the overall model binding;
  v2's model seeds Chat/Agent, configured Google seeds Ctrl+I, and an existing local
  Qwen coder preference (otherwise Qwen2.5-Coder3B/1.5B/7B) seeds automatic. No pulls
  or alternate-provider substitution. Session role choices reset on restart and
  unavailable overrides become explicit null choices. Native model-bound consent
  protects automatic sharing; source and suggestions are never persisted. Main
  owns routing and deadlines; renderer owns debounce/rate limiting, memory cache,
  TexLab/snippet coexistence and stale editor checks. FIM-only models are discovery
  results but never Chat/Agent choices. Inline-completion contribution is imported
  and prebundled with Monaco. GitHub remains deferred.

- 2026-10-21 owner defers GitHub and requests Codestral nested in Mistral. Dedicated
  codestral credential profile uses codestral.mistral.ai/v1 with independent key,
  listing/default/removal and shared Chat/Agent instructions. Keep normal Mistral
  Codestral availability as-is. Catalogue parent metadata controls visual nesting;
  child setup works with the parent unconfigured. No fallback between endpoints
  or credentials. Mistral's official Codestral endpoint announcement and current
  Codestral model page establish dedicated endpoint + chat/tool format; no live
  provider key used for verification.

- 2026-10-21 OpenRouter/GitHub: OpenRouter uses its authenticated account catalogue
  to validate the key and respect provider/privacy preferences, text-only models,
  fixed selected model, require_parameters=true and allow_fallbacks=false. Shared
  prompts and encrypted storage remain. Preserve reasoning_details/reasoning on
  Agent tool replay. GitHub Models retired July 30, 2026 per
  https://docs.github.com/en/github-models. Asked owner whether to integrate the
  official Copilot SDK or defer GitHub; no answer at checkpoint. Recommend SDK
  sign-in or fine-grained PAT with Copilot Requests, explicit tool allowlists,
  main-owned isolated runtime and identical TeXtra prompts. No retired provider card.

- 2026-10-21 AI catalogue/setup: add Mistral and DeepSeek using fixed official
  endpoints and encrypted per-provider keys. Share the compatible wire transport,
  preserve provider token fields and DeepSeek reasoning replay; keep one exact Chat
  prompt for every route. Filter to text chat using capabilities/modalities where
  present and model-family fallback for sparse listings/caches. Vision input with
  text output remains eligible. Ollama metadata 404/405 permits name fallback; other
  errors still surface. Existing cached specialist defaults repair without network
  or credential changes. Setup cards remain catalogue driven, with concise copy.
  API contracts verified against official Mistral Models/Chat, DeepSeek Models/
  Chat/Thinking Mode, Ollama Show model details, and OpenAI Models documentation.

- 2026-10-21 Agent multi-part reliability: replace the six-response/twelve-tool cap
  with 24 responses/64 tools. Each system prompt reports the remaining budget and
  asks for independent edits to be batched and a final response reserved. Error
  messages identify response/tool/source/output exhaustion. Existing 90-second
  provider deadline (180 seconds for Local Ollama), 64k source, 32k cumulative text,
  active-file-only tools, cancellation, stale guards and mandatory review remain.
  Exhausted runs still discard all staging; there are no automatic continuations.

- 2026-10-21 multi-provider AI (owner request): AI settings move to a dialog with one card
  per provider: Google Gemini, OpenAI, Anthropic, Ollama Cloud (ollama.com, key) and Local
  Ollama (127.0.0.1:11434, no key, status ping plus Start Ollama). Keys are tested by listing
  models; model lists come from each provider and are cached. Each provider has a default
  model and there is one overall default. The chat model picker is searchable and grouped
  by provider; the chosen model persists across Chat/Agent (supersedes the per-mode reset).
  Wire formats: Gemini generateContent (SDK), OpenAI Chat Completions, Anthropic Messages,
  Ollama native /api/chat. Agent uses a provider-neutral tool transcript. Unconfigured chat
  shows only a Configure AI button. The fixed seven-model Google allowlist is retired.
- 2026-10-20 shared AI defaults and handoff: Gemini 3.5 Flash Lite is the default
  for both modes; all seven configured Google models are available in either mode.
  No automatic model fallback. Chat requests very concise replies and reserves
  **Suggested fix:** for actionable corrections. A completed latest suggestion gets
  an explicit pill that switches to Agent and sends the bounded transcript with
  "Implement the suggested fix above." Draft text survives the handoff. Existing
  active-.tex scope and mandatory review remain. Show Agent disclosure once per
  profile, fade after five seconds, then remove it; this is UI state, not consent
  to send future requests. Precise insertion column feedback addresses observed
  live Gemini coordinate guessing within the unchanged six-call/twelve-tool cap.

- 2026-10-20 sequential review fix: Owner wants immediate per-change approval, not
  accumulated decisions plus Apply approved. New narrow review API validates hunk IDs,
  applies each accepted change to the expected buffer and rebases only undecided changes
  into a fresh single-use proposal/context. Renderer applies each accepted step undoably,
  removes it, and advances; the last decision closes. Approve all applies the remainder;
  Reject all preserves already accepted text. Auto-save pauses until review completes.
  Multi-step requests now have six model calls/twelve tools under the same60s deadline;
  all requested parts must finish naturally. Budget exhaustion discards staging rather
  than silently proposing a partial task. Only the final response supplies narration.

- 2026-10-20 follow-up: Preserve one transcript/draft across Chat/Agent switches and
  pass bounded conversation context into Agent. Workspace-specific history uses a
  canonical-root hash under userData/ai-chats with atomic writes; newest100 chats,
  80 messages/128k chars each,16MiB file cap. Credentials/pending proposals/drafts
  remain outside history serialization. Model menu adds 3.8/3.6 Flash and 3 Flash Preview,
  with Lite defaults unchanged and no automatic provider retry/fallback. Inline review
  collects per-hunk decisions, then Apply approved submits only shared deterministic
  hunk IDs to main. No arbitrary renderer-selected replacement string is accepted.
  Agent read tools accept omitted args and return bounded staged line tables; insert
  uses line/column and replacement prefers unique expected text. Re-reading staging
  is allowed inside the eight-tool/three-call budget; a valid final staged edit is
  returned for review at the cap rather than requiring another narration request.

- 2026-10-20: Owner expands the earlier chat-only policy to a bounded, optional active-.tex
  Agent. Chat allows only Gemini 3.5/3.1 Flash Lite; Agent allows only Gemma 4 26B/31B
  (26B API ID gemma-4-26b-a4b-it). Each switch resets to the mode default. Main stages
  pathless read/insert/replace tools with a three-call/eight-tool budget; explicit diff
  approval is required for one undoable buffer edit. No agent disk writes, deletions,
  other-file access, shell, automatic fallback or retries. Existing save policies apply
  after user approval. Repository-local encrypted single-key storage remains temporary.

- 2026-10-20: Owner requests Gemini debugging chat before remaining phase gates.
  Use exclusively gemini-3.5-flash-lite and official @google/genai; no AI file/process
  tools. Temporary repository-local config is encrypted with safeStorage already,
  refuses plaintext backends, and must migrate to userData before release. Ask in
  Chat drafts are bounded to five source lines either side; auto-send is off by default.

- 2026-10-18: Canonical project settings are .textra/settings.json with JSONC support
  and preserved legacy project.json migration. Recipe/tool keys use LaTeX Workshop
  syntax; main keeps a positive execution allowlist. Builder and JSON view share
  the same schema and stale-snapshot save protection. Stable configured PDF paths
  use a success version counter for reload, and default paths include RELATIVE_DOC
  to avoid same-name document collisions. Separate aux is limited to verified
  direct MiKTeX engines; custom output folders are never automatically deleted.

- 2026-10-18: User prefers thin, inset rounded source tabs; fill only active tabs.
  Keep inactive tabs transparent with close buttons revealed on hover/focus.

- 2026-10-18: Remove application header/status footer; keep Settings in a left
  activity rail. Preview owns Compile and Preview/Problems/Output tabs; compilation
  never changes tab selection. Persist sideways preview collapse in previewVisible;
  retain legacy outputVisible field only for preferences compatibility. PDF search
  is scoped Ctrl/Cmd+F; replacement routes to source with Ctrl/Cmd+H.

- 2026-10-18: Compile lives in the top bar and always targets the active .tex tab.
  Recipe dropdown replaces root/compiler controls. Remember each document's last
  used recipe in project.json; defaultRecipe is a portable app preference with
  legacy preferences migration. Existing explicit root/engine configs seed only
  that document's remembered recipe. Open folder moves into the explorer.

- 2026-10-18: Follow Electron/main/preload/renderer separation and electron-vite.
  Native Electron is required; a hosted website is not a substitute.
- 2026-10-18: Use explicit relative-path APIs and revision-checked writes to protect
  user files. TeX defaults to no shell escape. No cloud or AI dependencies.
- 2026-10-18: Lock exact installed dependency versions; validate declarations and
  official docs. Foundation gate must pass before later phase work.
- 2026-10-18: Bundle preload as CommonJS (`index.cjs`) for Electron's sandbox.
  Electron-vite 6 supports `build.externalizeDeps`; use no external preload deps.
- 2026-10-18: Override Monaco's pinned DOMPurify 3.4.15 with patched 3.4.17.
  Registry audit after installation reports zero vulnerabilities. Reassess on updates.
- 2026-10-18: Allow navigation only to the exact trusted main-frame app URL so
  preload reload works. Deny other URLs, redirects, subframes, and new windows.
- 2026-10-18: Phase 1 file operations will carry an opaque project session ID and
  SHA256 content revision. No force-save API. Reject symlinks and protected paths;
  poll only open files for external changes. User chooses roots via native dialogs.
- 2026-10-18: Builds use unique build/textra output directories and retain last-good
  PDF bytes in main, preserving preview after failed builds. No general command API.
- 2026-10-18: Settings are strict schema1, unknown versions preserved. Project
  overrides are opt-in; app exports exclude recents, paths, and credentials.
- 2026-10-18: Core native workflow passes but full Phase 1 remains incomplete;
  installer/manager actions and editable pipelines are the next gate work.
- 2026-10-18: Put Vite dependency cache in OS temp, keyed by checkout path, outside
  Dropbox/OneDrive. Explicit eager dependency list avoids incremental rediscovery.
  The synced node_modules cache repeatedly failed directory renames with EBUSY.
- 2026-10-18: Owner moved TeX installation help (winget/brew/package-manager flows,
  distribution manager launch) to Phase 4 and dropped `% !TEX root` support. Compile
  builds the active tab only. Custom tool paths must be absolute and name the exact
  tool, so a preference cannot point a TeX tool at an arbitrary program.
- 2026-10-18: Owner chose an unfiltered explorer. Path traversal, symlink, reserved-name
  and temp-file rules remain; protected-folder and aux-file blocks were removed from
  validateRelativePath. Deleting .git or .textra is therefore possible (OS trash only).
- 2026-10-18: Recipe editor is guided (list, toggle chips, output location choices) with
  JSON still available. The output-directory argument is shown as a locked chip because
  the planner always applies the configured output directory, so a toggle would not work.
  "PDF beside .tex, aux in build" is outDir=%DIR% plus auxDir=build folder and inherits the
  MiKTeX-direct-engine limitation.
- 2026-10-18: Sidebar differentiation. Icons are Phosphor (light weight, duotone for the
  active rail view) behind src/renderer/src/icons.tsx so the pack is swappable in one file.
  The Extensions placeholder was removed. A Document view was added beside Files: outline
  plus a used-files tree for the active .tex tab, resolved from the project root first and
  then the including file's directory (src/shared/tex-structure.ts, document-model.ts).
  Files stays unfiltered per the earlier explorer decision. Owner pinned (not approved yet)
  replacing the rail with a labelled segmented control; see ROADMAP.md.
