# ADR-084: PostgreSQL-authoritative Task state notifications

- Status: Accepted
- Date: 2026-07-16
- Supersedes: the 10 ms Task polling loop in the A2A executor

## Context

The A2A synchronous and streaming request path previously queried PostgreSQL every 10 ms until a
Task reached a response boundary. One waiting Task could therefore issue approximately one hundred
reads per second, and concurrent clients multiplied that load. The database remained authoritative,
but the adapter used it as both the state store and a high-frequency wake-up mechanism.

The V1 runtime is intentionally one process. PostgreSQL is the system of record, Redis is ephemeral
queue state, running Tasks are not recovered after process loss, and cross-process notification is
not required by the current deployment model.

## Decision

The application layer owns a protocol-neutral `TaskStateNotifier` contract. Its single-process
implementation keeps a bounded cache of the latest Task snapshots and a bounded-by-demand set of
waiters. Publishing wakes every current waiter, including when PostgreSQL timestamp precision makes
two meaningful transitions share the same `updatedAt` value. Remembered state wakes a later waiter
only when its timestamp is newer, preventing a stale cache entry from creating a busy loop.

Every production PostgreSQL path that successfully creates or changes `agent_task` publishes only
after the statement or surrounding transaction commits: the generic Task repository, continuation
input transaction, wait-timeout expiry, process recovery, Goal Patch, Goal cancellation, and atomic
Runtime Terminal Outcome transaction. A rolled-back write never publishes.

Notification data is advisory. After every notification or safety timeout, the A2A executor reloads
the Task from PostgreSQL before projecting protocol state. A missed notification is recovered by a
low-frequency safety poll. The production default is 1,000 ms and configuration below 100 ms is
rejected, so the old 10 ms behavior cannot be restored accidentally.

The A2A synchronous wait window ends by reloading and returning the current standard Task snapshot;
it never throws `A2A_TASK_WAIT_TIMEOUT`. A still-running Task remains `working`, background execution
continues, and clients may poll or resubscribe. Terminal, input-required, and capability-gap states
wake immediately. Runtime shutdown closes the notifier before closing the A2A endpoint, releasing
all waiters without changing Task authority.

The remembered Task cache is limited to 1,024 entries by default. It is not persistence, recovery,
or a cross-process event bus. A future multi-process runtime must introduce a separately reviewed
durable or database-backed notification transport while preserving the mandatory PostgreSQL reload.

## Consequences

- A single waiting Task performs a low-frequency safety read rather than about one hundred reads per
  second; ordinary state changes usually require one authoritative read after notification.
- Concurrent waiters no longer scale database reads with a 10 ms loop.
- Notification loss increases response latency only up to the configured safety interval and cannot
  change the returned state.
- No schema migration, second workflow runtime, SDK-domain type leak, or new system of record is
  introduced.
- Notifications are process-local and intentionally lost on crash; V1 process-recovery rules remain
  unchanged.
