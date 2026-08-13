# Phase P03 Report

## Source lock

- Repository: `zhouwen-giser/skill-driven-agent-runtime`
- Baseline: `origin/main` at `b7f02dcedc9680758e7e5f779a939a738d8de770`
- Repair branch: `fix/sdar-breakpoint-repair`
- Last committed branch SHA while this report was prepared:
  `0e0e58a81d17a43f8d3e269b015e3afb452ed1a6`
- Implementation state: present in the working tree; no P03 commit/push claim is made here.
- Physical device writes: `0`

## Breakpoint

`BP-SDAR-003` — A2A Terminal Projection Convergence.

Disposition: `FIXED`.

## Reproduction before fix

P00 reproduced a split view in which `getTask` overlaid Runtime `FAILED` for one response while the
durable A2A projection and `listTasks` remained `TASK_STATE_WORKING`. A later, older `WORKING`
projection could also overwrite a saved terminal projection. Notification loss or a process restart
left no autonomous path to repair the durable row.

## Root cause

`A2AProjectionTaskStore.load()` could consult Runtime authority, but `save()` persisted the incoming
SDK Task without re-reading the authoritative Task. PostgreSQL used an unconditional projection
upsert, and the server had no startup/periodic terminal reconciler. Request-local overlay and safety
polling therefore could not guarantee durable convergence.

## Implementation

- `A2AProjectionTaskStore.save()` now reads the Runtime-owned Task first and persists its canonical
  A2A state while retaining the inbound message history. A late `WORKING` or cancel save cannot
  reverse an already-terminal Runtime result.
- The PostgreSQL projection upsert is monotonic: a stored terminal state cannot regress to
  non-terminal or switch to a conflicting terminal state, and stale timestamps cannot overwrite a
  newer compatible projection. An authoritative terminal may still replace a non-terminal
  projection even when the notification timestamp is older.
- Added `A2ATerminalProjectionReconciler`. It scans only Tasks that already have an `a2a-v1`
  projection, reads Runtime Task authority, and repairs completed, failed, canceled, invalidated,
  and capability-gap outcomes. It never creates an A2A projection for an unadmitted Runtime Task.
- Runs reconciliation once during Runtime startup and periodically afterward. The interval defaults
  to 30 seconds, is bounded to 1–300 seconds, prevents overlapping runs, logs repair/failure
  summaries, stops on shutdown, and awaits any in-flight reconciliation.
- Reconciliation is idempotent: an already-converged projection produces no second write.

## Authority impact

Runtime `agent_task` remains authoritative. A2A remains a rebuildable projection and gains no
independent transition authority. PostgreSQL projection constraints and reconciliation both favor
Runtime terminal truth, while admission stays with the existing A2A adapter because only existing
projection rows are scanned.

## Tests

| Gate                                                          | Result | Evidence                                                                                                                                                                         |
| ------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                              | PASS   | Full repository TypeScript check, exit `0`                                                                                                                                       |
| Current P01-P03 focused Vitest selection                      | PASS   | 9 files, 108 tests                                                                                                                                                               |
| P03 Runtime PostgreSQL repository integration                 | PASS ON PRE-KEYSET REVISION | 75/75 tests ran before the final keyset-pagination refinement                                                                                                      |
| P03-stage fresh Node Control foundation PostgreSQL regression | PASS   | 11/11 tests before the later P01/P02 Management Operation cancel additions                                                                                                       |
| A2A projection-store unit tests                               | PASS   | Late WORKING save, cancel against an existing terminal result, and cancel-reconciliation failure                                                                                 |
| Terminal reconciler unit tests                                | PASS   | All Runtime terminal phases, notification-loss/restart repair, invalid stored document, non-terminal/missing authority, idempotence, admission preservation, and interval bounds |

The PostgreSQL regression proves that an older late `WORKING` write and a conflicting terminal write
cannot replace an already-persisted `TASK_STATE_COMPLETED` row. The final keyset-pagination change is
covered by unit and TypeScript checks, but the exact final P03 tree still requires an isolated
PostgreSQL rerun; the earlier 75/75 result is not presented as exact-candidate dynamic evidence.
Existing endpoint coverage for
failure, cancellation, input-required-to-terminal, capability gap, and replan exhaustion continues
to feed the same Runtime terminal mapping; the new repair is generic over terminal Task phases. The
11/11 Node Control foundation run is retained as a phase-stage regression result, not attributed as
proof of A2A behavior. The later 14/14 foundation result belongs to the combined P01/P02 cancellation
authority work.

## External findings

None. No SDAR consumer, SMPP, Home Assistant, or Organization Control Plane change was needed.

## Performance/security impact

Reconciliation is paged at 100 projections, bounded in frequency, single-flight, and limited to
existing A2A admissions. Aggregate performance qualification remains P06; this phase does not claim
production-scale performance. No auth surface or physical-control authority changed, and
`physicalDeviceWrites=0`.

## Commits / push verification

The baseline/evidence-preparation commit is
`0e0e58a81d17a43f8d3e269b015e3afb452ed1a6`. P03 implementation and this report were still
uncommitted at report time, so no P03 phase commit or remote-SHA equality is asserted.

## Status

`A2A_TERMINAL_CONVERGENCE_PASSED`
