# P00 — Latest Main Baseline & Breakpoint Audit

## Source lock

- Repository: `zhouwen-giser/skill-driven-agent-runtime`
- Source branch: `origin/main`
- Source SHA: `b7f02dcedc9680758e7e5f779a939a738d8de770`
- Source commit: `Merge pull request #20 from zhouwen-giser/codex/sdar-ugv-smpp-integration`
- Repair branch: `fix/sdar-breakpoint-repair`
- Package version: `1.4.1`
- Node.js: `v22.14.0`
- pnpm: `11.7.0`
- Physical device writes: `0`

The worktree was clean before branch creation. The repair branch was created directly from the
execution-time `origin/main` and its initial SHA was pushed without rewriting history.

## Baseline gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS | all 2 workspace projects already up to date |
| `pnpm typecheck` | PASS | exit 0, 37.5 seconds |
| `pnpm verify:node-control-contract` | PASS | 77 frozen files, 29 schemas, 131 operations, 20 events, 7 fixtures |
| `pnpm test:node-control` | PASS | 33 files, 158 tests |
| A2A notifier/executor focused tests | PASS | 2 files, 11 tests; request-local behavior only |
| Governance/recovery focused tests | PASS | 10 files, 96 tests; does not close the reproduced gaps below |

The frozen-contract verifier passing does not prove that each declared public operation has a
production route. That distinction is itself BP-SDAR-002.

## Current breakpoint classification

| Breakpoint | P00 classification | Current-main observation |
| --- | --- | --- |
| BP-SDAR-001 | `STILL_REPRODUCIBLE` | Frozen public and internal OpenAPI declare pause, resume, cancel, and goal-patch, but Node Control has no corresponding POST handlers or Runtime command port. |
| BP-SDAR-002 | `STILL_REPRODUCIBLE` | Contract inventory reports 131 operations, while the current gate validates frozen artifacts only; there is no inventory ↔ OpenAPI ↔ actual router ↔ RBAC ↔ contract-test conformance gate. |
| BP-SDAR-003 | `STILL_REPRODUCIBLE` | Runtime terminal state can be overlaid for one `getTask` response while the durable A2A row and `listTasks` remain `WORKING`; a late older `WORKING` upsert can also overwrite terminal state. |
| BP-SDAR-004 | `PARTIALLY_FIXED` | Governance and confirmation foundations exist, but enabled MCP discovery can still create a Temporary Skill without a governed Task Capability binding, and confirmation lacks a durable actor/authority receipt. Fire authority is not created by this Goal and remains hard denied by policy. |
| BP-SDAR-005 | `PARTIALLY_FIXED` | Waiting-external polling, duplicate suppression, and uncertainty primitives exist, but remote-call/admission, cancellation ACK, and continuation crash windows are not fully durably reconciled. |
| BP-SDAR-006 | `STILL_REPRODUCIBLE` | The latest checked-in authoritative full verification is failed. Its integration step failed, and attempt 8 diagnostic records Runtime P95 regression 40.1437% plus baseline median drift 15.0758%, above unchanged 10% and 15% gates. |
| BP-SDAR-007 | `ALREADY_FIXED_ON_MAIN` | PR #20 is merged. Explicit unauthenticated SMPP credentials and exact allowlisted RFC1918 private HTTP endpoints are implemented with regression coverage. |

## Reproduction details

### BP-SDAR-001 — Node Control Task Control

The frozen operation inventory contains:

- `pauseTask`: `POST /api/v1/tasks/{taskId}/pause`
- `resumeTask`: `POST /api/v1/tasks/{taskId}/resume`
- `cancelTask`: `POST /api/v1/tasks/{taskId}/cancel`
- `submitTaskGoalPatch`: `POST /api/v1/tasks/{taskId}/goal-patches`

The Runtime Control OpenAPI declares the matching `/internal/v1/tasks/{taskId}/...` commands.
Neither `apps/node-control-api/src/http-endpoint.ts` nor the Runtime management endpoint registers
those frozen routes. Runtime `TaskService` already owns the real phase/plan checks through
`cancel()` and `followUp()`; the missing boundary is an authenticated, idempotent Node Control →
Runtime command handoff with ManagementOperation and Audit persistence.

### BP-SDAR-002 — Operation conformance

`verify:node-control-contract` proves internal consistency of frozen documents. It does not load the
actual Express router or prove that every operation is authorized and contract-tested. BP-SDAR-001
therefore escaped a green 131-operation contract check. P02 must introduce a production-router-based
gate with deliberate negative fixtures for missing route, RBAC, and test coverage.

### BP-SDAR-003 — A2A terminal convergence

A deterministic production-store reproduction observed:

```json
{
  "getState": "TASK_STATE_FAILED",
  "durableState": "TASK_STATE_WORKING",
  "failedListCount": 0,
  "workingListState": "TASK_STATE_WORKING",
  "durableAfterLateOlderWorking": "TASK_STATE_WORKING"
}
```

`A2AProjectionTaskStore.load()` overlays Runtime authority in memory but does not repair the
projection. `list()` reads the stale durable document. The projection repository uses unconditional
upsert, so terminal state is not monotonic. The in-process notifier and request-local safety polling
are lost or stop after request exit; no startup/periodic reconciler closes that gap.

### BP-SDAR-004 — Governed control

Current main contains Task Capability, Skill, risk, confirmation, and evidence authority. The
remaining fail-open path is that `TemporarySkillResolver` may turn enabled discovered MCP Tools into
a temporary Skill without a Task Capability binding, while ordinary workflow transport permits an
undefined binding context. The Management confirmation boundary also lacks a durable authenticated
actor plus plan/capability hash receipt. This Goal will never create or enable
`vehicle_fire_weapon`; discovery alone must not grant selection or execution authority.

### BP-SDAR-005 — Recovery

Current primitives cover several ordinary paths, but P05 must close and test these exact windows:

- remote MCP call returns before durable binding/admission is recorded;
- remote cancellation returns before the ACK is durably persisted and a lease retry resends it;
- continuation callback fails after inbox persistence and the failed event is no longer retried;
- persisted remote expiration is not actively enforced on polling/recovery.

All recovery validation remains zero-device-write and must prove no duplicate logical or physical
side effect.

### BP-SDAR-006 — Verification and performance

P00 does not infer a new cause from historical output. It records only the current checked-in
authority: `reports/verification/summary.json` is failed, and performance attempt 8 is diagnostic,
not a waiver or repair. P06 must rerun the unchanged estimand, samples, and thresholds on the final
candidate and retain failed attempts.

### BP-SDAR-007 — External regression

Latest main contains the explicit credential-free sentinel and private-HTTP endpoint policy. P07 is
regression-only: no external repository write, no redesign, and no second implementation.

## Authority and safety impact

- Runtime PostgreSQL remains Task/Goal/Plan/execution authority.
- Node Control remains policy and governance authority and must not write Runtime tables.
- A2A remains a projection and cannot become a second state machine.
- SMPP and Organization Control Plane repositories remain read-only Integration SUTs.
- Physical device writes remain `0` for the entire repair.
- `vehicle_fire_weapon` remains outside authorized execution scope.

## P00 status

`P00_COMPLETE`
