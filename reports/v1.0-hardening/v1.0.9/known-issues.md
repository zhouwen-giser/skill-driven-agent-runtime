# v1.0.9 Known Issues

Date: 2026-07-16

- No known correctness issue remains after the independent bug-fixed audit.
- Composition traversal is intentionally capped at depth 8, 32 related Skills and 128 accepted relations; snapshot JSON is capped at depth 64. Exceeding a bound rejects planning instead of truncating evidence silently.
- Structural JSON Schema assignability is conservative for type, required object fields, arrays and enums; live child input and output still pass the current registered schemas at execution boundaries.
- `alternative` relations remain reserved for failure recovery and never grant initial `skill_call` authority.
- Historical plans created before migration 0062 remain readable and executable for compatibility, but their missing composition context cannot authorize a new plan or repair confirmation.
- Explicit capability-gap child IDs are an internal application input and are not accepted directly from the management HTTP surface.
