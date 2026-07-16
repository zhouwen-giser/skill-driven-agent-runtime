# v1.0.8 Changed Files

Date: 2026-07-16

## Domain and runtime

- `packages/domain/src/goal.ts`
- `packages/domain/test/goal.unit.test.ts`
- `packages/domain/src/skill-selection.ts`
- `packages/domain/src/workflow.ts`
- Skill retrieval/selection/replacement/Temporary Skill application services
- Workflow planner/revision/controller/execution and child Skill planning services
- Goal evaluation, Goal Patch, plan preparation and model-decision services
- `apps/server/src/runtime.ts`

## Persistence and public contract

- `packages/persistence-postgres/src/repositories.ts`
- `infra/postgres/migrations/0061_goal_execution_contract.{up,down}.sql`
- `packages/management-api/src/http-endpoint.ts`
- `schemas/management-api.openapi.yaml`
- `scripts/verify-migration-path.mjs`

## Verification and evidence

- application unit, management contract, PostgreSQL integration/migration and real A2A/Model/MCP E2E tests
- ADR-079, CHANGELOG, Project Status, ExecPlan, assumptions and both traceability matrices
- `reports/v1.0-hardening/v1.0.8/*`
