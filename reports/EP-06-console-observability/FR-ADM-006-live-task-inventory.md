# FR-ADM-006 live Task inventory increment

Date: 2026-07-13

## Delivered

- Bounded management Task inventory with `contextId`, `phase`, and `limit` filters.
- PostgreSQL ordering by most recently updated Task; no frontend fixture or secondary trace store.
- Console selection from real Task records and optional two-second refresh of the Task plus all linked Goal, Plan, Workflow node, model, MCP, result, inference, feedback, and evaluation evidence.
- Refresh remains read-only and never resumes or mutates a Workflow. Plan actions still use the explicit Task lifecycle endpoint.

The authoritative type remains the domain `AgentTask`; `TaskService` owns the query boundary and `PostgresAgentTaskRepository` owns persistence. No new ADR is required under ADR-066.

## Reproducible verification

- `pnpm exec vitest run packages/application/test/task-service.unit.test.ts packages/application/test/plan-preparation-processor.unit.test.ts packages/management-api/test/http-endpoint.contract.test.ts apps/console/src/console.unit.test.tsx` — 57 passed.
- `pnpm verify:management-openapi` — 102 operations matched.
- `pnpm lint`, `pnpm typecheck`, `pnpm verify:architecture`, and `pnpm build` — passed.

The PostgreSQL filtered-list assertion is implemented but not counted as executed because local Docker startup remains hung. Browser accessibility/E2E and the complete EP gate remain unverified.
