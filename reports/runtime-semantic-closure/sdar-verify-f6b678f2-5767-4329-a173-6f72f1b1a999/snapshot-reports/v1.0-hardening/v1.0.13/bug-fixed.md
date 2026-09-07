# v1.0.13 Bug-fixed Audit

Date: 2026-07-16

## Feature-version findings

- A final safety wait could reload PostgreSQL and then enter the top-of-loop timeout branch, causing
  one unnecessary second authoritative read at the deadline.
- Closing the executor released the notifier waiter but the resumed execution still reloaded the
  Task and published a status into the event stream being closed. This widened shutdown latency and
  left a needless database/event-bus race.
- The executor did not explicitly reject an execute call made after close; endpoint shutdown normally
  prevents it, but the component boundary itself was not fail-closed.
- Successful post-commit notification paths were covered, but transaction-fault tests did not yet
  assert that rolled-back terminal mutations publish no notification.

## Fixes

- Deadline handling now completes after the authoritative read already made by the final safety wait,
  returning the current working/terminal snapshot without a duplicate query.
- Close wakes waiters and finishes their event buses before any further Task read or status publish.
- New execution after close fails with stable `A2A_TASK_EXECUTOR_CLOSED` before Task submission.
- The existing five-location Runtime Terminal Outcome fault matrix now asserts zero notifications
  after every PostgreSQL rollback.
- Explicit configuration regressions reject the old 10 ms interval and a non-positive wait window.

## New and strengthened evidence

- Two new executor unit scenarios cover invalid wait configuration and execute-after-close.
- Close evidence now requires zero post-close Task reads.
- The optimized 250 ms samples require at most three reads for one waiter and four per concurrent
  waiter, while preserving missed-notification recovery and immediate state wakes.
- Real PostgreSQL faults before Result and after Task/Goal/Control/Event writes leave the notification
  list empty as well as rolling back every authoritative row.

## Remaining limitations

- Notification remains intentionally process-local and ephemeral. PostgreSQL is authoritative and a
  missed notification may add up to the configured safety interval.
- The actual numbers are deterministic local test evidence, not production throughput claims.
- V1 still does not recover or retry a running Task after process failure.

Feature tag SHA: `a13d8e76aee1764abf9cb8d828be60f183341dc2`.

Bug-fixed tag SHA: this bug-fixed commit / `v1.0.13-bug-fixed` pending publication.

Continuation decision: all required gates and demos pass; final acceptance audit may proceed after
bug-fixed publication.
