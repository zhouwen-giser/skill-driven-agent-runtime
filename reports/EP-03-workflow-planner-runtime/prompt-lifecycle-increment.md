# Prompt lifecycle increment

Date: 2026-07-12

Implemented PostgreSQL Prompt/PromptVersion authority, immutable create/publish/disable/rollback, inactive automatic candidates, per-stage current Prompt resolution, invocation linkage, and effect aggregation. AC-15-style same-process e2e proves a candidate does not affect calls, publication creates a new version, and subsequent calls link to it.

Real verification: PostgreSQL, management HTTP, local OpenAI-compatible HTTP, invocation audit and effect queries. Simulated/unverified: automatic candidate generation from evaluation/failure inputs remains EP-05.

Full gate: architecture 74 TypeScript sources; unit 50, integration 15, contract 21, e2e 12; format, lint, typecheck, build, local smoke, and selected A2A HTTP+JSON MUST harness (67 passed, 0 selected failures) all passed.
