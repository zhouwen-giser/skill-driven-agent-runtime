# NFR-PERF-002 Stage Duration Evidence

Date: 2026-07-13

## Delivered

- Model invocation audits persist `durationMs` and remain filterable by Task/stage/model.
- MCP invocation audits persist `startedAt`, `completedAt`, and `durationMs`.
- The sole LangGraph compiler now measures every completed or handled-failed Workflow node with its monotonic millisecond clock.
- PostgreSQL migration `0051_workflow_node_duration` persists nonnegative terminal-node duration while retaining compatibility with older `NULL` rows.
- Workflow management Trace and Console replay expose the persisted node duration without frontend inference.

## Verification

Real local verification:

- 36 targeted LangGraph/Application/Console unit tests pass.
- strict typecheck, lint, format check, architecture boundary verification, and production build pass.
- Unified `pnpm verify` passes: 53 unit/contract files with 219 tests, 160-file architecture guard, 102 management OpenAPI operations, 17 OSS source pins, Compose/bootstrap static checks, SBOM/license verification, and production build.

Implemented but currently unverified:

- PostgreSQL repository persistence and migration rollback/reapply assertions are present in `packages/persistence-postgres/test/repositories.integration.test.ts`. `pnpm test:integration` produced no output and timed out after 64 seconds because the local Docker/PostgreSQL/Redis services remain unavailable.
- Full real-API browser and end-to-end timing correlation remains unverified.

NFR-PERF-002 remains `开发中` until the PostgreSQL assertion and real end-to-end trace are reproducibly executed.
