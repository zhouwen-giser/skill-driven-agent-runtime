# ADR-029: Fail interrupted executions on process start

## Status

Accepted on 2026-07-12.

## Decision

- On every server process start, after PostgreSQL migrations and before the BullMQ Worker starts, one PostgreSQL transaction marks Task phases `executing`, `paused`, and `evaluating` as failed with `PROCESS_EXECUTION_LOST`.
- The same transaction marks Workflow instances `running` and `paused` failed, clears pending confirmation, records the terminal timestamp, and preserves all prior plans, events, results, usage, and errors.
- V1 never reconstructs a LangGraph checkpoint, resumes a running node, or automatically retries an interrupted Task. This prevents duplicate MCP side effects.
- Queued and planning/confirmation-waiting Tasks are not failed by startup recovery. Their BullMQ jobs remain Redis-authoritative and may be dispatched after restart.
- BullMQ job attempts remain exactly one, stalled-job retries are disabled, and failed jobs remain inspectable rather than being removed.
- Recovery is idempotent: after the first transaction, subsequent starts update zero interrupted records.
- Graceful process shutdown is distinct from crash recovery. The composition root tracks every fire-and-forget confirmed-Task control execution, closes ingress first, waits for active Worker and tracked execution promises, then closes MCP transport and PostgreSQL. A tracked failure is surfaced as an aggregate shutdown error rather than swallowed.

## Consequences

- Running work is deliberately sacrificed for side-effect safety, matching the accepted V1 limitation.
- PostgreSQL and Task projections expose a stable failure instead of leaving indefinitely running state.
- FR-EXE-008/009/010 have complementary PostgreSQL and real Redis integration evidence.
- The documented one-command example client exposed and now guards the graceful-shutdown ordering: a completed Task may still be writing evaluation/evolution evidence, so the pool cannot close merely because the external Task state is terminal.
