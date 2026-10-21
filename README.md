# TeXtra

A modern, local-first LaTeX desktop IDE. Your documents stay ordinary files on
your computer. Editing and local compilation never require an account; AI is
optional. AI chat works with your own Google, OpenAI, Anthropic, Mistral, DeepSeek, OpenRouter or Ollama Cloud key, or
with a local Ollama server.

![Native TeXtra editing and PDF preview](docs/screenshot.png)

## Current status

- [x] Phase 0: native Electron shell, themes, pane controls, command palette
- [x] Core IDE: real folders, Monaco tabs, safe saves, local builds, PDF.js, SyncTeX
- [x] Recent/pinned projects, file CRUD, portable settings, project build preferences
- [x] Editable ordered build recipes, project settings JSON and recipe builder
- [x] Phase 1 workflow: collapsible explorer, reveal-active, persisted editor settings, custom TeX paths, PDF match highlights
- [x] TexLab 5.26.0: bundled Windows language intelligence and editor navigation
- [ ] Phase 1 verification: XeLaTeX/LuaLaTeX, macOS/Linux, crop/rotation SyncTeX
- [ ] Phase 2: writing tools, diagnostics, optional AI
- [ ] Phase 3: research and presentation workflows
- [ ] Phase 4: installers, TeX installation help and distribution

## Development

Prerequisites: Node 24 LTS, npm 11; optional MiKTeX/TeX Live/MacTeX for compilation.
Git is recommended. No API key is needed. Open this repository and run:

```powershell
npm install
npm run dev
```

Validation: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`,
`npm run build`, `npm run test:e2e`. Installer packaging is not configured yet.
The primary iteration loop is a native Electron window with React HMR.
`npm run test:dev` verifies HMR and main/preload reload behavior; run it without
concurrent source edits because it temporarily appends and restores test probes.

## Workflow and setup

Use Ctrl/Cmd+K for commands, Ctrl/Cmd+B for the sidebar, Ctrl/Cmd+J to switch between
the preview and its Output tab, and drag the split or use arrow keys on it. Collapse
either side pane with its small collapse icon. Settings lives at the bottom of the
left rail, including the theme selector. Themes and layouts are saved
to `preferences.json` in Electron userData (`%APPDATA%/TeXtra` on Windows).
The rail has two sidebar views. Files is the plain project tree. Document shows the open
`.tex` file's section outline (included chapters spliced in place) and a tree of the files
it uses (`\input`, `\include`, `\subfile`, bibliographies, graphics, local style files),
not the directory contents. Missing references are flagged. Click a heading or file to jump.
Recent Projects is a collapsible section at the bottom of the explorer, closed by default.

1. Choose **Open folder**, then select a `.tex` file in the explorer. Multiple tabs
   preserve editor models and undo while open. Use Ctrl/Cmd+S to save, Shift+Ctrl/Cmd+S
   to save a copy, and Monaco's Ctrl/Cmd+F or Ctrl/Cmd+H for search/replace.
   Left-click an explorer entry for Rename, Delete, Reveal, and VS Code actions;
   files open in the editor as well. Right-click and Shift+F10 also open this menu.
2. **Compile** in the preview pane (Ctrl/Cmd+Enter) builds the active `.tex` tab and saves all
   dirty files first. Use its dropdown to choose a recipe. Each document remembers
   its last used recipe; **Settings → Compilation** sets the default for new documents.
   **Compile ▾ → Manage recipes…** edits defaults, creates recipes and opens the
   project JSON editor. See [project settings and recipes](docs/RECIPES.md).
   Presets: direct pdfLaTeX, XeLaTeX, LuaLaTeX, latexmk, and
   pdfLaTeX → BibTeX → pdfLaTeX twice. Cancel stops the process tree.
3. Switch between Preview, Output, and source-linked Problems inside the preview pane.
   Compile, the view tabs, and the collapse control share one compact row.
   Compiling preserves your selected view. Successful PDFs load beside the editor.
   Ctrl/Cmd+F within the preview opens PDF search; Escape closes it. Ctrl/Cmd+H opens
   replacement in the source editor, where edits can be recompiled. Navigate pages,
   zoom/fit width, or use **Go to source line**.
   Double-click the PDF to jump back to source with the installed SyncTeX tool.

External changes are watched as well as revision-polled. On detection, TeXtra locks ordinary
Save, autosave and Ctrl/Cmd+S for that tab, preserves its complete in-memory buffer, and opens a
conflict decision. Save a collision-safe sibling such as
`chapter.CONFLICTED_2026-10-20_143522.tex`, or close TeXtra’s buffer to give the external editor
precedence. After a configurable 2–5 second quiet period, a read-only Monaco diff can compare the
preserved buffer with the external file; it does not merge. Preferences can use polling only for
Dropbox/network folders. Save As never replaces an existing file. Closing/switching checks unsaved
edits. Delete uses the OS trash.

**TexLab language intelligence** is bundled for Windows x64 and enabled by default. It powers
LaTeX completion, hover, definitions, references, document symbols, folding, inlay hints, and
diagnostics. Disable it in **Settings → LaTeX tools** to use TeXtra's local fallback suggestions.
The bundled release is TexLab 5.26.0; attribution and source details are in
`resources/texlab/THIRD_PARTY_NOTICES.md`.

The gear button opens **Settings**, with a side list of sections: Appearance,
LaTeX tools (detected executables with an edit icon for each path, re-detection, a real
temporary test compile, official installer pages), Compilation, and Import & export. No installers or missing packages run automatically. Windows uses
MiKTeX/TeX Live; macOS can use MacTeX; Linux users should use their distribution's
TeX packages. Restart after PATH changes. If a tool is not on PATH, use the pencil beside it
in Settings to choose the executable. Guided installation moves to Phase 4.

Layout/theme, the default recipe, and recents live in Electron userData. Document
recipe choices and tool definitions live in `.textra/settings.json`, created when
opening a project. Legacy `project.json` is migrated without deletion. Open folders with
the folder icon in the explorer. Import/export accepts only versioned theme/layout/recipe
settings; unknown schemas and corrupt files are preserved. Recent folders, keys and
tool paths are excluded. Offline operation is the default. Settings save automatically; the
footer of Settings and AI settings shows Saving… and All changes saved, and **Save settings**
waits for pending writes (and submits a typed but unsaved API key) before closing.

The **AI Chat** rail tab opens a conversational debugger. Until a provider is connected it
shows a single **Configure AI** button that opens the **AI settings** dialog (also reachable
from the chat header **Settings** button and **Settings → AI Chat**). The dialog has one card
per provider: **Google Gemini**, **OpenAI**, **Anthropic**, **Mistral**, **DeepSeek**,
**OpenRouter**, **Ollama Cloud** and **Local Ollama**.
Mistral also contains a **Codestral** sub-card for its dedicated service, with a
separate encrypted Codestral key, model list and default. It can connect even if
the general Mistral card is not configured. Codestral models available through a
normal Mistral key remain selectable through the general Mistral connection.
**Save & load models** tests a key by listing that provider's models, then saves the
encrypted key with the model list. **Local Ollama** pings `127.0.0.1:11434`, shows whether it
is running, offers **Start Ollama** (runs the installed `ollama serve`) or a download link, and
needs no key. Each connected card has its own default model, **Refresh**, **Replace key** and
**Remove**; the top of the dialog sets the overall default model used for new chats and Agent.
The composer's model button opens a searchable list grouped by provider (type to filter by
model name, id or provider; arrows and Enter choose). Lists are limited to text chat
models: capability metadata is used where available, with model-family filtering
for providers that omit it. Vision input models that produce text remain available;
image/audio generation, embeddings and other specialist endpoints are excluded.
Refresh models updates capability checks. The chosen model stays selected across
Chat and Agent. Requests are sent in each provider's own format: Gemini generateContent,
OpenAI/Mistral/DeepSeek Chat Completions, Anthropic Messages, and Ollama's native `/api/chat`.
Every provider receives the same Chat system instructions; routing changes only
the endpoint and request format.
OpenRouter lists text models from its authenticated account catalogue, respecting
your account's provider/privacy preferences. It routes submitted text to the
selected model's hosting provider. TeXtra disables automatic provider fallback and
requires tool parameters to be supported in Agent mode. Dynamic auto/free router
entries are excluded so you choose an explicit model.
**New chat** clears prior conversation context and retries while preserving unsent draft text.
Settings can enable automatic
Problems prompts (off by default). **Ask in Chat** prepares the selected error plus five
source lines above and below for review. Sending shares that conversation/snippet with
the selected model's provider (nothing leaves the computer with Local Ollama). Chat has no file or command tools. Agent sends only the active `.tex` buffer
after an explicit request and can stage precise insertions/replacements in that file.
It cannot browse other files, delete files, or run commands. Every proposed edit opens
an inline read-only diff in the editor. **Approve** immediately applies that change to the
buffer and advances to the next; **Reject** skips that change. The final decision returns
to the normal editor. **Approve all** applies the remaining changes together; **Reject all**
discards the remaining proposal and preserves changes already approved. Each approval is undoable.
Auto-save pauses during review and resumes for approved text when review finishes.
Changing the file, its content, or its disk revision expires the proposal. Agent requests
include the preceding conversation for handoff and have a 24-response/64-tool budget
with a 90-second deadline (180 seconds for Local Ollama);
Problems drafts never auto-send in Agent mode. Mode switches preserve conversation and drafts.
Chat replies favor concise debugging fixes. When a reply includes a **Suggested fix**,
the **Implement Suggested Fix** pill switches to Agent with the conversation and a simple
implementation request. It requires an active `.tex` file; all proposed edits still need review.
The Agent privacy reminder appears on first selection, fades away, and stays dismissed
for that app profile. Clicking Send or the handoff pill remains the explicit sharing action.
**Chat history** restores workspace-specific conversations, including after restarting TeXtra.
History keeps the latest 100 chats per canonical workspace in local app data (`ai-chats/`),
with at most 80 messages/128,000 characters per stored transcript. History contains plaintext
conversation text, never API credentials or pending edits; it is excluded from settings exports.
Unsent drafts remain in memory. **Ctrl+Enter** sends; Enter inserts a newline. Cancel stops waiting
locally; a provider may still process a request already sent.
Responses stream as full-width Markdown with a copy action below; only your messages use
bubbles. The compact composer has two text rows, no resize handle, a model menu, and a circular
send arrow (a stop control during streaming). The introductory
guidance disappears once a conversation starts. The chat tab sits with the main rail views.

MVP AI settings live in git-ignored `.textra-local/ai.json` inside this application checkout,
with each key encrypted by Electron `safeStorage` for your OS account. No plaintext fallback
is allowed. Do not distribute this local directory or put it under source control. Before
public release, migrate it to global app data; see [security](docs/SECURITY.md).
Provider pricing, free tiers and limits depend on your account; TeXtra adds no fee.
Quota notices suggest switching models or trying again later, with a link to that
provider's usage page.

Recipes default to `build/textra/<relative document>/` and retain the last successful
PDF through failures. Custom output folders are never automatically pruned. The
temporary installation health check uses an isolated folder.

## Architecture and contribution

`src/main` owns files/processes; `src/preload` is the narrow typed bridge;
`src/renderer` contains the UI; `src/shared` defines contracts; `tests` contains
fixtures and verification. Read [AGENTS.md](AGENTS.md) before contributing.
Run all checks before a change is considered complete.

## Troubleshooting

- Missing TeX: check `pdflatex --version` and restart after changing PATH.
- Failed build: inspect the full Output panel; missing packages may need your distribution manager.
- SyncTeX: requires the executable and output produced with `-synctex=1`.
- PDF preview: a failed compile may leave no new PDF; use the last successful build.
- Conflict: Save As preserves your buffer; Reload from disk requires confirmation.
- Invalid project settings: preserve and inspect `.textra/project.json`; move it
  aside manually before recreating settings. Do not delete it blindly.
- Development startup: install dependencies and run typecheck/build for actionable errors.
- Dropbox/OneDrive: the development dependency cache lives in OS temp to avoid
  sync locks. If output cleanup reports EBUSY, close the running app before rebuilding.

Source content stays local. TeX input is powerful: compile trusted projects only.
See the [security](docs/SECURITY.md), [architecture](docs/ARCHITECTURE.md),
[testing](docs/TESTING.md), and [unfinished work](docs/ROADMAP.md) guides.

License: **pending owner decision; no open-source license granted yet.**
