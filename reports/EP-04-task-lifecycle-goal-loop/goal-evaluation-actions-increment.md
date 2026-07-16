# Goal evaluation actions increment

Date: 2026-07-12

## Scope

This increment verifies FR-RST-004 and FR-RST-005. It extends the existing PostgreSQL-authoritative outer Workflow controller; LangGraph.js remains the only Workflow execution runtime.

## Reproducible evidence

- `pnpm typecheck` — passed.
- `pnpm test:unit` — 30 files, 110 tests passed.
- `pnpm test:integration` — 2 files, 25 tests passed against real PostgreSQL and Redis containers.
- `pnpm test:contract` — 7 files, 34 tests passed.
- `pnpm test:e2e` — 1 file, 25 tests passed against the local server, PostgreSQL, Redis, model loopback, official A2A adapter path, and Mock MCP.

The E2E control scenario executes Workflow version 1, persists `adjust_plan`, generates version 2 outside LangGraph, executes it, persists `achieved`, and only then transitions the Goal to achieved. Unit tests cover all required continuation families, strict action-specific evidence, zero subsequent planning for input/capability waits, immutable replanning, confirmation, and budget exhaustion. PostgreSQL integration replays a structured Skill-replacement decision.

## Verification boundary

Real verification covers the outer controller, persistence, management API path, model loopback, and MCP execution. Model semantic quality is simulated deterministically. This historical increment left FR-RST-006 unverified; ADR-081 and v1.0.10 now verify capability-gap evidence as a persisted terminal A2A `FAILED` Task rather than a waiting state.
