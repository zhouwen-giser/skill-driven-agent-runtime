# v1.0.9 Changed Files

Date: 2026-07-16

## Domain and runtime

- `packages/domain/src/skill-graph.ts`
- `packages/domain/src/workflow.ts`
- `packages/application/src/skill-composition.ts`
- Workflow planner/validator/execution/controller/revision, Goal Patch, child Skill and confirmation services
- `apps/server/src/runtime.ts`

## Persistence and public contract

- `packages/persistence-postgres/src/repositories.ts`
- `infra/postgres/migrations/0062_skill_composition_context.{up,down}.sql`
- `packages/management-api/src/http-endpoint.ts`
- `schemas/management-api.openapi.yaml`
- `scripts/verify-migration-path.mjs`

## Verification and evidence

- application unit, management contract, PostgreSQL integration/migration and real A2A/Model/MCP E2E tests
- ADR-080, CHANGELOG, Project Status, ExecPlan, assumptions and both traceability matrices
- `reports/v1.0-hardening/v1.0.9/*`
