# ADR-034: Goal cancellation runtime-first atomic cascade

## Status

Accepted on 2026-07-12.

## Decision

- Canceling an active Goal first enumerates its running/paused Workflow instances and applies each immutable Skill-version cancellation strategy through the in-process LangGraph runtime.
- Only after active executions reach terminal state does one PostgreSQL transaction mark the Goal canceled, cancel every nonterminal bound Task plus earlier unbound same-context Task, invalidate active plans, terminate residual instances, and persist immutable cancellation evidence.
- A Goal cancellation always records its reason, Task/Plan/instance identities, selected-policy warnings, and timestamp. It never performs automatic compensation.
- Task persistence is terminal-monotonic: a stale Worker cannot overwrite `completed`, `canceled`, `failed`, or `invalidated` with an active phase. Such a write fails explicitly.
- Missing in-memory control for a persisted running instance aborts the cancellation request rather than claiming side-effect-safe cancellation. Process-start recovery must settle lost execution first.

## Consequences

- A successful Goal cancellation guarantees that no known active Workflow can start another node.
- Multiple Tasks sharing the Goal terminate together, including queued same-context work created before cancellation but not yet Goal-bound.
- Plans remain inspectable but non-executable through `invalidated` confirmation status.
- External effects completed before cancellation remain and are disclosed through the no-compensation warning.
