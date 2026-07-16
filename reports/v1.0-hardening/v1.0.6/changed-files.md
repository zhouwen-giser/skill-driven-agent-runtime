# v1.0.6 Changed Files

Date: 2026-07-16

## Runtime and domain

- `packages/domain/src/runtime-terminal-outcome.ts`
- `packages/domain/src/workflow-control.ts`
- `packages/application/src/ports.ts`
- `packages/application/src/result-processing-service.ts`
- `packages/application/src/workflow-controller.ts`
- `packages/application/src/task-service.ts`
- `packages/persistence-postgres/src/repositories.ts`
- `apps/server/src/runtime.ts`

## Schema and verification

- `infra/postgres/migrations/0058_runtime_terminal_outcome.up.sql`
- `infra/postgres/migrations/0058_runtime_terminal_outcome.down.sql`
- `scripts/verify-migration-path.mjs`
- application, PostgreSQL integration and A2A E2E regression tests

## Evidence

- ADR-077, CHANGELOG, Project Status, ExecPlan, storage schema and both traceability matrices
- `reports/v1.0-hardening/v1.0.6/*`
