# Known issues

- Environment: managed sandbox blocks npm DNS and atomic rename in sandbox temp.
  Approved npm install works; tests now use workspace test-results and pass inside
  sandbox. Native Electron checks need desktop execution. Preserve atomic writes.
- Unimplemented phases are tracked in docs/ROADMAP.md, not advertised as complete.
- Packaging, signing, cross-platform behavior and installer UX remain unverified.
