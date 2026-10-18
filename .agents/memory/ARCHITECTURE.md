# Architecture memory

Root coordinator owns config, shared/api.ts, docs/memory and integration.
Bounded delegates may own main/preload, renderer, or tests exclusively.
Shared contract changes require coordinator agreement. Main owns OS; renderer
calls window.textra through preload. See docs/ARCHITECTURE.md for data flow.

ProjectService owns canonical root + opaque session token; all file operations
carry token and relative paths. SHA256 protects saves. Protected/generated paths
and symlinks/junctions are excluded. Renderer polls <=50 open files and retains
content/savedContent/revision. Counted busy operations make editor read-only;
delayed reload compares project/content/revision before replacing text.

BuildService uses fixed tool argv, no shell, no shell escape/package installer,
bounded time/logs and process-tree termination. PDF reads expose cached bytes only
for the exact last-success output. PDF.js worker is local. ConfigService owns
.textra/project.json with schema1 safe atomic writes. Transfer bundles include
only exact portable preference fields, never secrets.
