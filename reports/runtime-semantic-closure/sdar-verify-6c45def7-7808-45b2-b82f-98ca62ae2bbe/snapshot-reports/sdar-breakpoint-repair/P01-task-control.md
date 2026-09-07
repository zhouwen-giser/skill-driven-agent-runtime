# Phase P01 Report

## Source lock

- Repository: `zhouwen-giser/skill-driven-agent-runtime`
- Baseline: `origin/main` at `b7f02dcedc9680758e7e5f779a939a738d8de770`
- Repair branch: `fix/sdar-breakpoint-repair`
- Last committed branch SHA while this report was prepared:
  `0e0e58a81d17a43f8d3e269b015e3afb452ed1a6`
- Implementation state: present in the working tree; the P01 implementation/evidence commit and push
  are intentionally deferred to the owning delivery step.
- Physical device writes: `0`

## Breakpoint

`BP-SDAR-001` — Node Control Task Control.

Disposition: `FIXED`.

The frozen public and Runtime contracts declare pause, resume, cancel, and Goal Patch commands. P01
closes the previously missing production boundary without moving Task phase, Plan, or execution
authority out of Runtime.

## Reproduction before fix

P00 confirmed that these public operations and their internal counterparts were present in frozen
OpenAPI but absent from the production Node Control and Runtime management routers:

- `POST /api/v1/tasks/{taskId}/pause`
- `POST /api/v1/tasks/{taskId}/resume`
- `POST /api/v1/tasks/{taskId}/cancel`
- `POST /api/v1/tasks/{taskId}/goal-patches`

The green frozen-contract check therefore did not make the commands callable. Historical Console
requests received `404`, and no authenticated, durable Node Control to Runtime command handoff
existed.

## Root cause

The repository already had Runtime-owned `TaskService.cancel()` and `TaskService.followUp()` phase
and Plan checks, but it lacked the HTTP/application/persistence chain needed to reach them. Node
Control also lacked a durable accepted/running/terminal Management Operation with audit and replay
identity. Retrying after an uncertain dispatch could not be distinguished safely from a new command.

## Implementation

- Registered all four public Node Control routes and all four service-authenticated Runtime routes.
- Added the protocol-neutral `NodeControlTaskControlService` and HTTP Runtime client. Public commands
  carry actor, reason, correlation ID, Idempotency-Key, optional payload, and optional expected
  revision across the boundary.
- Restricted public Task control to `node_admin` and the explicitly enabled
  `organization_service` profile. The Runtime boundary accepts only its internal service bearer
  token.
- Persisted Node Control Management Operation transitions and immutable audit records before and
  after dispatch. Same key plus same input returns the same terminal operation; same key plus
  different input returns a stable `409` before another Runtime call.
- Reused the PostgreSQL-backed `CognitiveManagementActionGate` at the Runtime boundary. Migration
  `0156_v14_runtime_task_control_actions` admits only the four new governed action kinds and has a
  guarded down migration.
- Delegated cancel to `TaskService.cancel()` and pause/resume/Goal Patch to
  `TaskService.followUp()`. Consequently every POST rechecks authoritative Runtime state instead of
  trusting projected `controlledActions`.
- Treats a recovered in-flight/uncertain dispatch as a stable conflict and never optimistically
  repeats the Task mutation. Goal Patch replay is therefore at-most-once across the covered crash
  boundary.
- Added pre-dispatch Management Operation cancellation. Cancellation after dispatch is rejected;
  no result claims that an already dispatched physical effect was rolled back.
- Returns frozen `202` Management Operation responses and stable Problem Details for authentication,
  validation, not-found, terminal/invalid phase, unsupported/unavailable authority, idempotency
  conflict, and uncertain recovery.

## Authority impact

Runtime PostgreSQL remains the sole Task/Goal/Plan and phase-transition authority. Node Control
persists governance intent, audit, and the Runtime operation receipt; it does not update Runtime Task
tables. `controlledActions` remains advisory projection data. The repair creates no second Task
state machine and authorizes no physical device or weapon action.

## Tests

| Gate                                                            | Result | Evidence                                                                                                                                |
| --------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                | PASS   | Full repository TypeScript check, exit `0`                                                                                              |
| Current P01-P03 focused Vitest selection                        | PASS   | 9 files, 108 tests                                                                                                                      |
| P01 Runtime PostgreSQL repository integration                   | PASS   | 76/76 tests against an isolated fresh PostgreSQL Compose project                                                                        |
| Runtime Task command migration contract                         | PASS   | 0156 up/down action list, rollback guard, and no table replacement                                                                      |
| Task control HTTP/application contracts                         | PASS   | Four routes, auth, reason/key/revision validation, authority delegation, exact replay, conflict, restart replay, and uncertain recovery |
| Combined P01/P02 Node Control foundation PostgreSQL integration | PASS   | 14/14 tests after the Management Operation cancel-authority additions                                                                   |

The real PostgreSQL run proves generic claim/start/complete persistence for `task_pause`,
`task_resume`, `task_cancel`, and `task_goal_patch`, exact replay through a new repository instance,
and conflict rejection for a changed request hash. The separate 14/14 foundation run proves
accepted-intent recovery, exact terminal replay, pre-dispatch cancel, dispatch/cancel serialization,
and no duplicate Runtime call.

## External findings

None. No external repository was modified or needed to close P01.

## Performance/security impact

This phase adds bounded hashing and PostgreSQL governance transitions per command; aggregate
performance qualification remains a later phase. Both HTTP boundaries fail closed, bearer tokens
are not recorded in reports, and the response contains only hashes rather than raw Idempotency-Key
values. `physicalDeviceWrites=0`.

## Commits / push verification

The baseline/evidence-preparation commit is
`0e0e58a81d17a43f8d3e269b015e3afb452ed1a6`. P01 implementation and this report were still
uncommitted at report time and therefore have no phase commit or remote-SHA equality claim yet.
Commit/push verification belongs to the subsequent delivery step.

## Status

`TASK_CONTROL_PUBLIC_CONTRACT_PASSED`
