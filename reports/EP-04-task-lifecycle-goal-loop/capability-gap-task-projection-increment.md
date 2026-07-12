# Capability-gap Task projection increment

Date: 2026-07-12

## Scope

This increment verifies FR-RST-006 from fixed Goal evaluation through the authoritative Task and official A2A SDK client.

## Evidence

- Unit tests validate TaskService transition, structured evidence, audit event, and zero-next-plan control behavior.
- PostgreSQL integration round-trips Task capability evidence through migration 0030 and repository schema validation.
- The real local E2E starts an A2A Task, confirms and executes its immutable Workflow, receives a fixed-stage `capability_gap` decision, and retrieves the Task with `INPUT_REQUIRED`, a missing-capability message, and suggested tool contract.
- The same E2E queries the persisted Workflow evaluation round and proves that no additional plan or node is started.

Final gate evidence:

- `pnpm verify`: 37 files and 145 unit/contract tests passed; format, lint, strict typecheck, architecture boundaries, source pins, Compose validation, SBOM/licenses, and production build passed.
- `pnpm test:integration`: 2 files and 26 tests passed against local PostgreSQL and Redis containers.
- `pnpm test:e2e`: 1 file and 26 tests passed.
- `pnpm smoke:server`: server build smoke, dynamic Agent Card, and trusted-intranet management health passed.

## Verification boundary

PostgreSQL, Redis, server, official A2A adapter/client path, and Workflow execution are real local components. The model response is deterministic loopback simulation, and the required missing MCP capability is deliberately absent. No production or external system is contacted.
