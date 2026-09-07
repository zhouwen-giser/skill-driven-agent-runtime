# v1.0.13 Implementation

Date: 2026-07-16

ADR-084 replaces the A2A executor's 10 ms PostgreSQL loop with an application-owned, process-local
`TaskStateNotifier` plus a low-frequency authoritative safety read. The notifier has a bounded
1,024-Task latest-state cache, supports multiple waiters per Task, wakes same-timestamp transitions,
and releases all waiters idempotently on close.

All seven production PostgreSQL Task mutation paths publish only after their statement or enclosing
transaction succeeds: ordinary Task save, input continuation, wait expiry, process recovery, Goal
Patch, Goal cancellation, and atomic Runtime Terminal Outcome. Rolled-back work does not publish.

Notification state is never authoritative. The A2A executor reloads PostgreSQL after every wake or
safety interval. The default safety interval is 1,000 ms and values below 100 ms are rejected. At the
30-second default synchronous wait boundary, the executor reloads and returns the current standard
Task snapshot instead of throwing `A2A_TASK_WAIT_TIMEOUT`; a running Task stays working and continues
in the background.

The existing A2A E2E runtime uses a 5,000 ms safety interval so its 46 scenarios demonstrate the
commit notification path for terminal, input-required, capability-gap, return-immediately, stream
disconnect, polling, resubscribe, cancellation and timeout behavior. PostgreSQL remains the system
of record and no migration or second runtime was introduced.

Feature commit/tag: `a13d8e7` / `v1.0.13`, remotely verified.
