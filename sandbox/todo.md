# To Do List
## UI Updates
### General
- Change: For the save animation on file pills, the width of the pill should not change when the "unsaved changes" dot is present. 
- Change: PDFs can now open in the preview, which is good. But we don't actually need the warning. Just open them when clicked.
- Fix: In the editor, if I CTRL + SHIFT + Back, the editor selects one word to highlight at a time, rather than increasing the number of words highlighted. Note: This does not happen all the time! You fixed it before, and it worked, but then when I type something, and then try, it stops working again. I am unclear what the trigger is. 

### Settings
- Change: Under Appearance, the Accent, "Surface" color likely needs a border, since it is necessarily the same color as the surface.
- Change: The AI settings seems to have different font styles than other settings. Harmonize.

### Editor
- When I click a PDF to open in Preview, it does. But after doing so, the Preview no longer shows Markdown documents in the Preview automatically. Somthing is overriding this trigger. Fix this, but also put a md document icon in the formatting bar instead of the PDF icon when a mardown document is the active file, and make it always clickable to see a MD preview

### Files Tab
- Change: "Reveal folder" should go to the File Explorer *within the folder*, not in the parent folder, as it currently does. 
- Change: Put the "Open Folder" icon right next to the Reveal in File Explorer icon, so all three are together.

### Writing Tab
- Change: The collapsible sections should *not* be wrapped in a pill. Just have the toggle section, no pill.
- Change: Ensure the % TODO icon has the same color as the TODO accent pill

### Build Tab
- Fix: The Compile button in the header should display the same success/error message as the main Compile button in Preview. They seem partially linked at present, but without the message.
- Add: Add a "Clear Auxilliary Files" icon to the Build tab header. Use a sweep icon of some kind. This should just safely clean any aux file associated with the current .tex tile (based on directories from the active recipe, or a state we know of some kind). Never delete the PDF. Put this to the right of the Problems icon in that header. 

### Snippets & Symbols
- Change: Double clicking works. When we single click, we should expand to the card that looks like the "Add Snippet" card with the Snippet Name, Description, and Code. For custom snippets, an edit icon should be available (just the icon, same size as the header icons).

### Assistant Tab
- Change: Get rid of the border/circle around the "Dismiss notice" button, and ensure the X is visible (curerntly appears to be the same color as the surface). Just use an X icon if possible.
- Fix: The "copy" icon in fenced code blocks has a circle around it. It should just be the copy icon, no border/circle.

### Keyboard Shortcuts Tab
- Fix: "Add Shortcut" doesn't appear wired to do anything. Fiz so we can add shortcuts.

### Preview Pane
**Problems**
- Fix: The "Copy Prompt" and "Ask in AI" buttons in Problems should have slightly different content when the warning or error comes from chktex or texlab or anything else other than the compile. Just add that this was comething flagged by chktex/texlab/etc. That way the AI will know where the flag comes from, and the user may be able to set rules to ignore such errors. For example, chktex flagged ""8: Wrong length of dash may have been used.", which is irrelevant since I am deliberately using UTF-8 encoding, but a user may never know what is going on. Add something along the lines of "This was flagged by chktex, not the compiler." (use your discretion to find the right words).
- Fix: The top of the pane which currently has " X problems | Previous | X of Y | Next" -> This should have the same height as the formatting bar in editor, as should the part with all the error tags (Error, Warning, Info, etc). That way, whichever appears first shares the same height as the other element for symmetry.