# ADR-093: Persisted-frontier remote Task continuation

## Status

Accepted on 2026-07-16.

## Context

ADR-088 requires a remote MCP Task to end the active LangGraph invocation and later continue only the affected branch. A process-local `MemorySaver` checkpoint cannot be recovery authority, and starting the immutable Workflow from `START` would replay completed side effects. Native LangGraph parallel barriers also cannot consume predecessor arrivals from an earlier process invocation.

## Decision

- The Domain owns a bounded, versioned `WorkflowContinuationSnapshot`. It records immutable Task/Goal/plan/definition/instance identity, waiting node runs, runnable frontier, stable node-run ordinals, outputs/errors/routes/loop and recovery counts, accumulated budget, execution context and parallel predecessor-arrival evidence. It contains no SDK, LangGraph, Redis, ORM, credential or private reasoning objects.
- PostgreSQL is authoritative for the single active snapshot per Workflow instance, append-only continuation attempts and control-event claims. Redis contains only idempotent one-attempt scheduling. A running attempt is not recovered or retried after process loss; only queued attempts are reconciled.
- A remote Tool handle is committed as a binding before a node may return `waiting_external`. A persistence failure cannot fabricate a wait: the runtime best-effort requests Provider cancellation and records a credential-safe uncertainty warning.
- The `tools/call` handle is admission evidence, not an authoritative `tasks/get` snapshot. Every accepted handle therefore enters local polling and receives an authoritative first poll even when its embedded status appears terminal; only the ordered poll/control path may activate continuation.
- A waiting node emits `node_waiting_external`, does not emit success, does not satisfy a parallel join and routes only its current branch out of the active invocation. Other runnable parallel branches may finish before the snapshot is activated.
- Continuation creates a fresh LangGraph invocation and supplies the validated pure-data state with `Command({ update, goto: frontier })`. It never invokes `START`, LangGraph interrupt/resume or an old `MemorySaver` checkpoint. The compiler alone derives continuation frontier and synthetic join-arrival gates from the immutable DSL plus persisted predecessor evidence; Application does not become a second workflow scheduler.
- A control claim validates Goal version, confirmed plan, instance/snapshot/binding/node-run identity and parent terminal state under PostgreSQL locks. Duplicate, stale, patched or terminal events become audit-only. Completed success injects node output, completed `isError` and failed/cancelled use the existing error route, and observation-only events never create a graph run.
- `waiting_external` is a durable nonterminal Workflow/Task projection. Startup recovery exempts only rows backed by a valid active snapshot and binding. Ordinary running, paused or continuation-running work retains `PROCESS_EXECUTION_LOST` behavior.
- Child Workflow waits propagate as child lineage, not as the parent's remote Task identity. The child completes its own continuation before a local trigger can resume its parent.
- A child Workflow instance is persisted before its parent/child lineage row and before LangGraph execution. This preserves the child-instance foreign key while ensuring the lineage is already queryable when a nested MCP call admits a remote Task.

## Consequences

Remote waits survive process and Redis restart without recovering arbitrary in-flight Workflow execution or replaying completed effects. Snapshot size, hash, schema version, state-version CAS, budget carry-over and node-run ordinals become security and correctness boundaries. Parallel continuation requires compiler-owned synthetic arrival evidence, but LangGraph.js remains the only execution runtime and the Workflow definition remains immutable.

Phase 5 still owns input answers, cancellation lifecycle and Provider business-time outcomes. ADR-077 remains authoritative for final Task/Goal/Control/Result commit; continuation cannot bypass that transaction.
