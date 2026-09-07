# v1.0.3 Changed Files

## Runtime

- `packages/domain/src/task-input.ts`, Task phases and typed errors
- `packages/application/src/task-service.ts`, `plan-preparation-processor.ts`, `workflow-controller.ts` and ports
- `packages/persistence-postgres/src/repositories.ts`
- `packages/runtime-redis/src/bullmq-context-queue.ts`
- A2A/management mappings and `apps/server/src/runtime.ts`

## Persistence and design

- Migration `0055_task_input_continuation` up/down
- ADR-074 and storage schema documentation

## Tests and evidence

- Application unit tests for input lifecycle and both continuation paths
- PostgreSQL restart/rollback integration, Redis attempt identity/serialization integration
- Two real A2A/PostgreSQL/Redis/LangGraph/MCP E2E continuation paths
- Version, changelog, status, ExecPlan, traceability and release reports
