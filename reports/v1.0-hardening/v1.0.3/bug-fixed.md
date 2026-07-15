# v1.0.3 Bug-fixed Review

Date: 2026-07-15

## Findings and fixes

- The feature transaction answered the input and created its continuation attempt before a separate Task phase save. A process stop between those writes could leave a durable queued attempt attached to a Task still marked `awaiting_user_input`. The repository now commits request answer, response, attempt and Task continuation phase in one PostgreSQL transaction.
- Redis enqueue remained a separate durability boundary. `TaskAttemptDispatchService` now reads only PostgreSQL attempts whose status is `queued` and idempotently dispatches them at startup and on a bounded interval.
- A retained completed/failed BullMQ Job with the same composite identity could suppress a still-authoritative queued attempt. Queue admission now replaces only such terminal stale Jobs; waiting/active Jobs remain idempotent no-ops.
- Startup recovery previously failed interrupted Tasks and Workflow instances but did not close their running attempt records. It now marks running attempts failed with `PROCESS_EXECUTION_LOST`; the dispatcher never selects running or failed attempts.
- Supplementary input was not bounded. Answers longer than 64,000 characters now fail with `TASK_INPUT_RESPONSE_TOO_LARGE` before the request, response, attempt or Task is changed.

## Review outcome

- Duplicate, expired, missing and wrong-Task input requests retain stable rejection behavior.
- Goal-deliberation continuation stays on the original Task, and Goal-evaluation continuation remains bound to the exact control round and produces a fresh unconfirmed plan.
- Same-Context serialization and BullMQ `attempts: 1` remain unchanged.
- Feature tag: `v1.0.3` / `c25e92b2043b8b426bdfa9316a0cc76a078c8098`.
- Bug-fixed commit/tag: reconciled after publication.

## Remaining boundary

PostgreSQL is authoritative and Redis is ephemeral. A queued attempt is safe to redispatch because its processor changes the database status to `running` before business execution. Running and failed attempts are never recovered or automatically retried, preserving the V1 process-failure invariant.
