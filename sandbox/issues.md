## Manual app check list

### External-file conflict safety

- [x] Open a `.tex` file, make unsaved edits, then edit/save it externally. Confirm a conflict dialog appears promptly.
- [x] While the external editor is repeatedly writing, confirm the dialog shows an active/changing state and comparison waits.
- [x] Confirm the tab gains a warning state and the editor becomes read-only.
- [x] Confirm Save, autosave, and Ctrl/Cmd+S cannot overwrite the original.
- [x] Choose **Save conflicted copy**. Confirm it creates a sibling named like `chapter.CONFLICTED_YYYY-MM-DD_HHMMSS.tex`, opens it, and leaves the external original unchanged.
- [x] Trigger another external write and use **Create another snapshot**. Confirm a new collision-safe name is created.
- [x] Enable “Compare with external version when stable.” Confirm the read-only two-pane diff opens only after the quiet period.
- [ ] Use **Refresh comparison** after another external change; confirm it never enables editing or merging.
  - This seems to be unnecessary, since we automatically detect changes every few seconds anyway. We can get rid of this.
- [x] Choose **Close TeXtra buffer**. Confirm it writes nothing and the external file remains intact.
- [ ] Rename or delete the open file externally. Confirm dedicated recovery messaging and that the in-memory text can still be saved as a conflict copy.
  - This actually creates a problem. The usual edit dialogue pops up, but has no way to resolve anymore since the filename id different. You may need to allow for this use case (perhaps now we can save the current file in the buffer with the original filename OR the conflict tag), and have an "X" button to close the dialogue (I had to restart the app since it was stuck).
- [ ] In Settings → Preferences, check:
  - [x] Detection toggle.
  - [x] 2–5 second quiet-period choices.
    - The dropdowns should have the same style as the Heading dropdown. NOTE: More generally, create a dropdown component that is common across all such dropdowns. Perhaps it can have a small, medium, and large modifier, and then refactor all dropdowns to use this common component.
  - [x] Polling-only mode.
  - [x] Optional automatic diff after snapshot.
- [x] In a Dropbox/network folder, enable polling-only and repeat an external-change test.
  - This seemed to work, but seemed to work exactly the same as the usual flow.

### Core editing and files

- [x] Open a project, create/rename/delete files and folders, and confirm paths remain inside the project.
- [x] Open multiple `.tex` tabs; check dirty indicators, close confirmation, Save As, and session restoration.
- [x] Check Monaco editing: syntax highlighting, search/replace, folding, completion, word wrap, minimap, font size, and formatting toolbar.
- [x] Verify external changes with no local edits also enter the safe conflict flow.

### Compilation and preview

- [x] Compile a simple document with pdfLaTeX, XeLaTeX, and LuaLaTeX if installed.
- [x] Confirm compilation saves ordinary dirty files first but stops when a conflict is unresolved.
- [x] Check successful PDF preview, page navigation, zoom, search, Output, and Problems views.
- [x] Check a deliberate LaTeX error links to the correct source location.
- [x] Test source ↔ PDF SyncTeX if available.
  - We don't currently have back or forth arrows between the panes to test this out. Add these (like overleaf) to try to go from text editor position to document, and vice versa. However, when I double click text on the PDF, the curos moves to the right place in the editor, so that is good. And the "find editor cursor in the PDF" button works. So I think it is just the arrows that could help.

### Writing tools and settings

- [x] Verify outline/document references, snippets, equation palette, writing counts/TODOs, and Problems navigation.
  - With the exception of TODO and FIXME. These may work, but I don't know how to actually create such tags in a tex document. Explain it to me, and ensure there is a tooltip on that section so that users who aren't familiar with these tools can use them for the first time.
- [x] Check TexLab completion/hover/definition and fallback behavior when disabled.
  - See below, but I would like the Texlab autocomplete menu to have the same styling as the standard dropdown component, but with the appropriate icon.
- [x] Confirm ChkTeX save/live modes and latexindent’s preview-before-apply behavior.
- [ ] Export/import settings and ensure source files and recents are unaffected.
  - It works, but the Apperance editor, while functional, just needs a quick tweak: The theme dropdown button seems oddly clipped on the left (just the accent border color shows up on the left curves, but not the left side).

- [x] Confirm the safety rule: after an external change is detected, TeXtra never writes the open buffer to the original path without an explicit conflict decision.

## Other Issues:

1. Whenever I write "%", the terminal pops up {"timestamp":"2026-10-20T14:26:09.617Z","level":"warn","event":"ipc-request-failed","details":{"channel":"textra:texlab:request","code":"INVALID_ARGUMENT"}} (with the right timestamp) for every % or space after it.
2. If I want to select text forward, I can use CTRL + SHIFT + <Forward Arrrow>. But if I go backwards, it stops at the start of the line, and won't go up lines. Sometimes it even doesn't let me go backwards at all, at least not while selecteing. What it does id allow me to press the keys, and highlights the one word backwards, but then the next press takes me to the end of the next (previous) word, with nothing selected, then the next selects that word, etc. So w weird choppy word by word highlight. Note that this isn't ALWAYS the case. It seems inconsistent for some reason.
3. In the compile tab, it takes a lof of vertical space. Collapse sections by default except Build (and add a compile button below the recipe selector), then have teh Current Recipe be a normal section like everything else. Also, allow for vertical scrolling on all tabs if necessary.
4. In the Monaco editor, there is no minimap. Have this for long file (>= some reasonable number of lines)
5. The formatting toolbar can be hidden via the "..." menu, which is good, but there should also be a subtle icon in it that allows it to be hidden.
6. The Heading dropdown now doesn't stay open. I click, it opens, but when I move my cursor it immediatly disappears. It should stay open until my cursor finds it, then close when my cursor leaves it.
7. For the external safety dialogue: The "Give precedence to the external editor" red button needs to be given just a bit of padding between the text above it and the button.
8. For the external safety dialogue: The first pass of an external change worked, but then when I resolved and made another change to the file, after the file "stabilised", it immediately went to the diff view. I suspect that my choice to press the button to see the different triggered a state that was kept indefinitely. These states may need to be reset when a diff is resolved.

## Additional Changes:

1. Delete the Document tab. The writing tab now does the same thing. But put files used in the writing tab.
2. Create a tooltip under Notes in teh writing tab to explain to people how to add TODO or FIXME tags.
3. Instead of the big "Saved" button, just have the border of the pill for the file name at the top of the editor animate briefly (along withthe xisting dot that indicates unsaved changes going away).
4. Only have the latex language server stuff happening in .tex files. People may open markdown or other code files. the editor should still allow basic text edits, but shut off the fancy features.
5. The Format Document button is great, but instead of being in the "..." manu in the editor, it should be in the Writing tab, with more explanation for what it will do.
6. In the right click menu under Files, add a "Duplicate" or copy option for a file.
7. For deleting files, just go right to the system confirmtion. We don't need 2 confirmations. Same for rename.
8. Can we use more custom design for the language server suggestions? At present, they seem to have their own stock theme, with rectangular boxes, highlighted in their own color. Can we have these look like the Heading dropdown? Still with the icons they use, just consistent branding.
9. If the file is a markdown file, the preview pane should just view the markdown with a normal markdown viewer (not editor). This is the only "other" file type that gets a Preview pane override.
10. Under the Problems tab, put all problem category tags/badges on one line (though it can gracefully stack if the pane is small)
11. Add a "Keyboard Shortcuts" tab to Settings, and showcase the existing ones, and allow for new ones to be added (these likely show up in settings.json, but you can decide if there is a better place for them.)
12. For the external edits diff, the left rail icon should be different from the "Recent Projects" history icon. Choose one to change and choose an appropriate icon for it.
13. Reorder the left rail tabs: Files, Writing, Compile, Equations, Snippets, Search
14. If a user clicks on a PDF in Files, it should ask if they want to send this to Preview, and, if they say yes, it should replace whatever is in Preview (which is ovewritten on the next compile). That way they can still open PDFs to view.

## Big Additional Change: Common Problem Parsing

For the problems pane, I want to create a set of very common errors (e.g. undefined control sequence, or missing $ inserted). Make a list of the top 10 (those, maybe overfull/underfull, runaway argument, etc.) that can be detected with a simple regex. Then, when they show up, the problem card should show all the usual things, but also a more plain text explanation and, ideally, a link to an appropriate page (e.g. from https://texfaq.org/) that helps explain it further. This doesn't need to cover every edge case, just the super common ones that are infuriating for first-timers. We can toggle this extra help off in settings, but it is on by default.
