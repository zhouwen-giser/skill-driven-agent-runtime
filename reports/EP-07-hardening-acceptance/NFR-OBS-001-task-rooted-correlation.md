# NFR-OBS-001 Task-Rooted Correlation Evidence

## Outcome

Every required record type owns a stable persisted identifier and has a deterministic Task-rooted path. No link depends on timestamps, names, or browser-only state. Migration 0052 closes the two audit gaps found during this review: Task-mediated Plan confirmation now records `confirmation_task_id` and `confirmed_at`, and Goal Patch records now retain `triggering_task_id`.

## Correlation map

| Evidence | Authoritative identifiers | Task-rooted path |
| --- | --- | --- |
| Task and context | `agent_task.task_id`, `agent_task.context_id` | trace root |
| Task state change | `runtime_event.event_id`, `task_id`, `context_id` | exact `listByTask(taskId)` |
| Plan confirmation | `workflow_plan.plan_id`, `confirmation_task_id`, `confirmed_at` | Task `plan_id`; Task-mediated confirmation also points directly back to the Task |
| Workflow node | `workflow_node_event.event_id`, `instance_id`, `node_id`, `sequence` | Task `plan_id` → latest immutable instance → ordered node events |
| Model invocation | `model_invocation.invocation_id`, `task_id` | exact `listInvocationsByTask(taskId)` |
| MCP invocation | `mcp_invocation.invocation_id`, `task_id`, `context_id` | exact `listInvocationsByTask(taskId)` |
| Goal Patch | `goal_patch.patch_id`, `triggering_task_id`, `goal_id`, invalidated Plan/instance IDs, `new_plan_id` | Task `goal_id` history plus direct triggering Task identity |
| Evaluation | `task_quality_report.report_id`, `task_id`, `workflow_instance_id` | exact Task quality-report query; influence records retain `report_id` and `task_id` |

The Console Task panel consumes those exact management queries for Task events, Goal/Patches, Plan/latest trace, processed results, inference, quality, feedback, model calls, and MCP calls. Missing in-progress evidence remains an explicit unavailable result and is never fabricated.

## Executed evidence

- `pnpm typecheck` passed after the correlation model and repository changes.
- 65 targeted unit/contract/static-console tests passed across Workflow execution/control, Goal Patch, management endpoints, and the Task trace UI.
- Unified `pnpm verify` passed: 54 unit/contract files and 225 tests, format, lint, strict typecheck, 160-file architecture guard, 102-operation OpenAPI drift check, 17 OSS pins, Compose/bootstrap static checks, SBOM/licenses, TypeScript build, and production Console build.
- Application tests prove the Plan confirmation service passes and returns the exact triggering Task identity and timestamp.
- Management contracts prove Task-filtered event/model/MCP queries, Plan trace, persisted Plan confirmation time, and Goal Patch triggering Task projection.
- The migration is additive, idempotent, and has rollback/reapply assertions.

## Current real environment evidence

- `pnpm test:integration`: 2 files/36 tests passed, including Plan confirmation Task/time, Goal Patch triggering Task, and rollback/reapply assertions.
- `pnpm test:e2e`: 1 file/40 tests passed against PostgreSQL, Redis, loopback model, Mock MCP, A2A, management API, and LangGraph.
- A real browser opened a completed Task and loaded 12 correlated queries. The same persisted Task identity navigated to Workflow, MCP Tool, model Provider/model, and Evaluation; Workflow/MCP/model/Evaluation views exposed reverse Task navigation.
- The sampled trace displayed exact Task/context/Goal/Plan IDs, ordered Task events, processed result, five-component quality report, model and MCP invocation IDs, Goal evolution, immutable Workflow instance, and ordered node events.
- `pnpm smoke:infra`, `pnpm smoke:server`, and unified `pnpm verify` passed; unit/contract is 54 files/242 tests.

NFR-OBS-001 is **verified**.
