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

## Defined but not executed in this environment

- PostgreSQL integration assertions persist and reload Plan confirmation Task/time and Goal Patch triggering Task identity, including retention after Goal Patch invalidates the old Plan.
- Migration rollback/reapply verifies both Workflow Plan confirmation columns and the Goal Patch Task column.
- The complete local A2A/management E2E remains unavailable because PostgreSQL/Redis Docker services do not start in the current environment.
- A current bounded TCP probe reported both `127.0.0.1:54329` PostgreSQL and `127.0.0.1:56379` Redis unreachable.

NFR-OBS-001 therefore remains **developing**, not verified, until the real PostgreSQL integration suite and real API/browser E2E execute successfully.
