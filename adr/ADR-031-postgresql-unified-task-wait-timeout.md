# ADR-031: PostgreSQL unified Task wait timeout

## Status

Accepted on 2026-07-12.

## Decision

- Plan-confirmation and supplementary-input waits share one PostgreSQL-authoritative timeout in seconds. The trusted-intranet management API can read and update it.
- A same-process scheduler compares the waiting Task's persisted `updated_at` with the current policy. Policy changes intentionally apply to current as well as future waits.
- Expiry is one PostgreSQL data-modifying transaction: matching Tasks become terminal `canceled`, receive stable `TASK_WAIT_TIMEOUT` evidence, and receive a persisted phase-change event.
- The scan is idempotent because only the two waiting phases are eligible. Completed, failed, canceled, invalidated, executing, paused and queued Tasks are never selected.
- PostgreSQL remains authoritative; the timer stores no correctness-critical in-memory deadline. A delayed scan after process downtime expires overdue waits after restart.

## Consequences

- Confirmation and input waits cannot silently remain open indefinitely.
- A shorter administrative timeout may immediately expire an existing wait on the next scan; this is visible through the managed policy and audit event.
- V1 uses periodic scanning rather than per-Task durable timer jobs, avoiding a second timeout authority in Redis.
