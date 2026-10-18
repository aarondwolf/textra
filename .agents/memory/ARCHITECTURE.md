# Architecture memory

Root coordinator owns config, shared/api.ts, docs/memory and integration.
Bounded delegates may own main/preload, renderer, or tests exclusively.
Shared contract changes require coordinator agreement. Main owns OS; renderer
calls window.textra through preload. See docs/ARCHITECTURE.md for data flow.
