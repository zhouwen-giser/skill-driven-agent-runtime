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

Current real verification:

- `pnpm test:integration`: 2 files/36 tests passed, including PostgreSQL duration persistence and migration rollback/reapply.
- `pnpm test:e2e`: 1 file/40 tests passed against PostgreSQL, Redis, loopback model, Mock MCP, and the sole LangGraph runtime.
- The real in-app Console loaded the persisted Workflow trace through the management API; terminal node events carried nonnegative `durationMs` values (13 ms and 0 ms in the sampled execution).
- `pnpm smoke:infra`, `pnpm smoke:server`, and unified `pnpm verify` passed; unit/contract is 54 files/242 tests.

NFR-PERF-002 is `已验证`.
