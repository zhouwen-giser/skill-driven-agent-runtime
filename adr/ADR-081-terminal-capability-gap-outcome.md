# ADR-081: Terminal capability-gap outcome

## Status

Accepted on 2026-07-16. Supersedes the waiting/resume semantics in ADR-037.

## Context

The runtime already records structured capability-gap evidence, but the Task domain treated `capability_gap` as resumable and the A2A adapter projected it as `input-required`. That permits follow-up actions or stale persistence writes to mutate the original Task after an upstream Agent registers a missing Tool. The locked v1.0.10 contract instead requires a new A2A Task; the old Task must remain an auditable terminal result while its Goal may remain active for same-Context continuation.

## Decision

- `capability_gap` belongs to `TaskTerminalPhase` and `isTerminalTaskPhase()`. Its transition set is empty, it stores `errorCode=CAPABILITY_GAP`, and every follow-up is rejected. Protocol cancellation is idempotent and leaves an already-terminal Task unchanged.
- `capability_gap` also belongs to the terminal `WorkflowControlStatus` predicate. The evaluated round and final instance remain the evidence for the stopped control; the Goal itself remains active.
- A2A projects the Task as standard `TASK_STATE_FAILED`. Metadata contains `errorCode`, the complete structured `capabilityGap`, and `nextAction=register-capability-and-submit-new-task`. It is never projected as `input-required`.
- Registering or refreshing an MCP Tool does not scan, resume, enqueue, or execute the old Task. A new A2A Task in the same Context follows the normal queue and planning path and may reuse the active Goal.
- PostgreSQL Task and WorkflowControl generic saves reject stale writes after capability gap. Goal-wide and runtime cancellation exclude terminal capability-gap rows, while Goal cancellation may still end the independently active Goal without rewriting the historical Task/Control.
- The unified wait-timeout query continues to target only plan-confirmation and user-input waits. Capability gap is not a wait and cannot expire into another phase.
- No migration is required: existing phase/status constraints and `capability_gap_json` already store the domain values and evidence. This increment changes terminal authority and protocol projection, not the persisted shape.

## Consequences

The original Task has one monotonic, auditable outcome. Upstream capability registration is deliberately decoupled from execution, so no newly discovered Tool can trigger work without a newly submitted Task. The Goal can continue across that new Task in the same Context, while LangGraph remains the only Workflow execution runtime and no MCP Tasks behavior is introduced.
