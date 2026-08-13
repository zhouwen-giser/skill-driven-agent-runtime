# Phase P05 Report

## Source lock

- Repository: `zhouwen-giser/skill-driven-agent-runtime`
- Baseline: `origin/main` at `b7f02dcedc9680758e7e5f779a939a738d8de770`
- Repair branch: `fix/sdar-breakpoint-repair`
- Last committed branch SHA before this phase evidence was frozen:
  `5bb5de0d4def7c77e08ec9ffbf89263fd517ff9f`
- Physical device writes: `0`

## Breakpoint

`BP-SDAR-005` - Remote/In-flight Recovery.

Disposition: `PARTIALLY_FIXED`.

The repair closes several concrete replay and stranded-state failures, but the external Task
creation-to-local-admission crash window remains unresolved. The phase exit token
`REMOTE_IN_FLIGHT_RECOVERY_PASSED` is therefore not asserted.

## Implemented recovery semantics

- A cancel delivery claim now durably changes `requested` to `uncertain` before the outbound call.
  If the process crashes after claim, lease expiry does not blindly resend a possibly delivered
  physical cancellation.
- Workflow continuation persists a reusable terminal attempt. When the post-persistence callback
  fails, the control event is deferred and reclaimed; the graph continuation is not executed a
  second time.
- A recovered `running` continuation with no provable graph commit terminates as explicit
  `WORKFLOW_EXTERNAL_CONTINUATION_OUTCOME_UNCERTAIN` rather than being optimistically replayed.
- Remote Task TTL is enforced before another Provider read.
- Missing frozen Runtime revision or invalid remote contract now closes the binding through an
  explicit `task.failed` uncertainty control instead of leaving `waiting_external` quarantined
  forever.
- PostgreSQL remains authoritative. Redis remains wake-only and owns no recovery fact.

## Remaining blockers

1. After a remote `tools/call` creates a Provider Task, the process can still crash before the local
   remote binding/admission envelope is durably recorded. The saved MCP invocation is insufficient
   to reconstruct every authority field, and blindly replaying the call could duplicate a physical
   side effect. This needs a protocol/idempotency-aware durable admission design, not a retry.
2. The deferred continuation callback spans hierarchy completion and parent control changes. A
   failure after a partial callback mutation is not yet proven exactly-once across every nested
   step, even though the graph continuation itself is fenced.
3. Binding recovery freezes protocol/schema/Runtime revision facts but does not yet carry a complete
   catalog checksum suitable for every stale-catalog decision.
4. The new PostgreSQL recovery assertions were not dynamically executed in the current environment.

## Validation

| Gate | Result | Evidence |
| --- | --- | --- |
| Cancellation, continuation, polling, and workflow focused tests | PASS | 4 files, 56 tests |
| Full repository TypeScript check | PASS | `tsc -p tsconfig.json --noEmit`, exit `0` |
| Targeted ESLint, Prettier, and `git diff --check` | PASS | Phase-owned files |
| PostgreSQL workflow-continuation integration additions | NOT EXECUTED | The protected operator PostgreSQL rejected repository credentials; Docker isolation was unavailable in this execution environment |
| Real SMPP/physical recovery | NOT RUN | Deterministic-only phase; `physicalDeviceWrites=0` |

The PostgreSQL test additions cover cancel pre-send uncertainty and deferred callback reclaim, but
they are not counted as a pass until executed against an isolated database.

## Authority and side-effect impact

No uncertain outbound cancellation or remote Task creation is retried merely to make progress.
Explicit uncertainty is preferred over duplicate physical side effects. Runtime PostgreSQL remains
the Task and continuation authority, and this phase does not modify SMPP or any external repository.

## Status

`BLOCKED_REMOTE_ADMISSION_CRASH_WINDOW_AND_DYNAMIC_PG_EVIDENCE`
