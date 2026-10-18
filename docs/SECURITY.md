# Security model

Renderer uses context isolation, sandbox, disabled Node integration and a CSP.
Navigation and new windows are denied. Main validates IPC sender and arguments.
The bridge never exposes raw ipcRenderer or a generic exec operation.

All project paths must remain beneath the canonical selected root. Reject
traversal, absolute paths, protected/generated paths, and escaping symlinks.
Files use revision checks and atomic replacement. Dirty buffers must survive
failed saves and project switches. Destructive operations require confirmation.

TeX is executable input. Compilers run only after user action, with shell escape
disabled, a timeout and cancellation. This is not an OS-level TeX sandbox: open
and compile trusted projects only. External installation is not automatic.

No AI/network source transmission is implemented initially. Future providers need
explicit context disclosure, secure key storage, cancellation, and spending controls.
Logs must redact secret-like values. Never include environment dumps or keys.

Review focus: IPC, symlinks, traversal, concurrent edits, process lifecycle, PDF
input bounds, safe URLs, and restore paths. Report vulnerabilities privately to
the owner; a public security contact remains an owner decision.

Implemented limits: 5MiB UTF8 text, 10,000 tree entries, 50 tabs, 2MB build log,
64MiB PDF, 16M-pixel render backing/image bounds, 120s compile, 5s SyncTeX.
MiKTeX auto-install/first-line format parsing and shell escape are disabled;
latexmk uses -norc. PDF XFA is disabled and its worker is bundled locally.
Portable Node cannot atomically bind every path check to subsequent OS operations;
revalidation narrows but does not eliminate hostile concurrent TOCTOU mutation.
