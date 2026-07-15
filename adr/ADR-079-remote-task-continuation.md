# ADR-079: Remote Task External-wait Continuation

## Status

Accepted on 2026-07-16.

## Context

An MCP Tool may accept work that completes much later. Keeping the LangGraph node Promise open consumes process resources and cannot survive restart. Reusing LangGraph interrupt/resume would incorrectly model Provider observations as human graph input and could replay already completed nodes after checkpoint loss.

## Decision

- The sole LangGraph executor may return a typed `waiting_external` execution result containing a validated continuation snapshot.
- The active graph invocation ends after the snapshot and binding commit. The immutable plan remains unchanged.
- Polling persists ordered observations and idempotent control events. A continuation service claims one control, validates binding/Goal/plan/version/terminal state and resumes only the affected node/branch through a new runtime invocation.
- Input-required reuses Task input request/response storage, but its source is `remote_task`; the answer is sent through `tasks/update` and never starts fresh Goal planning.
- `waiting_external` bindings are excluded from startup interrupted-running failure. Other running Workflow/Task states retain the V1 fail-on-process-loss rule.
- Parallel branches and child Workflows persist explicit join/lineage state. A remote result cannot bypass parent confirmation or terminal consistency.

## Consequences

Remote Tasks can survive process/Redis restarts through PostgreSQL reconciliation while SDAR still truthfully refuses general in-flight Workflow recovery. The continuation snapshot becomes a security-sensitive validated record with size/version bounds and stale-event rejection.

## Rejected Alternatives

- Hold a Promise and poll inside the LangGraph node: not restart-safe and leaks resources.
- LangGraph interrupt/resume for Provider events: wrong semantic owner and replay risk.
- Re-run the whole Workflow: duplicates upstream side effects and violates immutable-instance behavior.
