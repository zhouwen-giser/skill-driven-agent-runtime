# v1.0.7 Changed Files

Date: 2026-07-16

## Runtime and domain

- `packages/domain/src/skill-input-resolution.ts`
- `packages/application/src/skill-input-resolution.ts`
- `packages/application/src/plan-preparation-processor.ts`
- `packages/application/src/task-service.ts`
- `packages/application/src/goal-patch-service.ts`
- `packages/application/src/memory-service.ts`
- `packages/persistence-postgres/src/repositories.ts`
- `apps/server/src/runtime.ts`

## API, Console and schema

- `packages/management-api/src/http-endpoint.ts`
- `schemas/management-api.openapi.yaml`
- `apps/console/src/PromptPanel.tsx`
- `apps/console/src/SystemPanel.tsx`
- `apps/console/src/TaskPanel.tsx`
- `infra/postgres/migrations/0059_skill_input_resolution.{up,down}.sql`

## Verification and evidence

- application, management, PostgreSQL and real A2A/MCP regression tests
- `scripts/verify-migration-path.mjs`
- ADR-078, README, CHANGELOG, Project Status, ExecPlan, assumptions and both traceability matrices
- `reports/v1.0-hardening/v1.0.7/*`
