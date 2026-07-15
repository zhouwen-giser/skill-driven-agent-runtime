# v1.0.2 Changed Files

## Runtime

- `packages/application/src/skill-call-workflow.ts`
- `packages/application/src/workflow-execution.ts`
- `apps/server/src/runtime.ts`

## Tests and evidence

- `packages/application/test/skill-call-workflow.unit.test.ts`
- `packages/application/test/workflow-execution.unit.test.ts`
- `packages/a2a-adapter/test/task-service-endpoint.e2e.test.ts`
- ADR-042 status, ADR-073, version/CHANGELOG/status/ExecPlan, traceability and release reports.
- Bug-fixed: `packages/domain/src/skill-call-workflow.ts`, PostgreSQL repository/tests, runtime migration list, migration verifier, storage documentation and migration `0054_skill_call_history` up/down.

Migration: none in the feature increment; bug-fixed adds `0054_skill_call_history` with rollback notes.
