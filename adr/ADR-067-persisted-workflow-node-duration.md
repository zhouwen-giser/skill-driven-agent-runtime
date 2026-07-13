# ADR-067: Persisted Workflow Node Duration

## Status

Accepted on 2026-07-13.

## Context

NFR-PERF-002 requires queue, model, MCP, and Workflow-node duration evidence that operators can use to locate slow stages. Model and MCP invocations already own explicit `durationMs` values. Workflow replay persisted start and terminal timestamps but did not expose an explicit node-duration value.

## Decision

- The sole LangGraph compiler measures each node from immediately before `node_started` until its terminal success or handled-failure event using the runtime monotonic millisecond port.
- Terminal `WorkflowNodeEvent` records own a nonnegative optional `durationMs`; start events have no duration.
- PostgreSQL persists the value in `workflow_node_event.duration_ms`. Existing rows remain valid with `NULL` duration.
- Management Trace returns the domain-owned event unchanged, and the Console displays the persisted duration. The browser does not derive duration from timestamps.
- Migration `0051_workflow_node_duration` is additive, idempotent, and has an explicit rollback.

## Consequences

Operators can compare node, model, and MCP durations from authoritative records. The change adds no execution runtime and does not mutate Workflow definitions or running graphs. Older node events remain replayable but correctly show no duration evidence.
