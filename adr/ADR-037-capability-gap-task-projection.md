# ADR-037: Capability-gap Task projection

## Status

Accepted — 2026-07-12

## Context

The Goal evaluator could identify and persist a capability gap, but FR-RST-006 requires the Task itself to wait and the client to read both the missing capability and a suggested tool contract. The A2A projection store also preferred a newer cached protocol document over `agent_task`, which could hide state changes produced outside the A2A request handler.

## Decision

- `AgentTask` owns optional structured `capabilityGap` evidence: the displayable evaluation summary, missing capability, and suggested tool name, description, and input schema.
- A Workflow control may bind a `taskId`. When its fixed Goal evaluation returns `capability_gap`, it calls TaskService to perform the domain transition, persist evidence, and publish a summarized audit event. It starts no further Workflow node.
- The A2A adapter maps `capability_gap` to protocol `INPUT_REQUIRED`, includes the evidence in Task metadata, and exposes a concise status message.
- On direct Task load, `agent_task` is always authoritative for current domain state. Stored A2A documents contribute protocol history only; their timestamps may not override domain state.
- Core modules contain no A2A SDK types. PostgreSQL stores the evidence as validated JSON through migration 0030.

## Consequences

Clients can retrieve actionable missing-tool information through the normal A2A Task API. Semantic evaluation is still performed by the fixed model stage, while Task transitions remain domain validated and auditable. Projection-list materialization remains optimized around stored protocol documents; direct Task reads are the current-state authority.
