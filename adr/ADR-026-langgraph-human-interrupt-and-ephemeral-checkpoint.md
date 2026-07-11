# ADR-026: LangGraph human interrupt and ephemeral checkpoint

## Status

Accepted on 2026-07-12.

## Decision

- A `human_confirmation` DSL node uses LangGraph.js native `interrupt` and `Command({ resume })`. It never emulates continuation by rerunning the Workflow or its preceding nodes.
- PostgreSQL is authoritative for the Workflow instance status and the displayable pending confirmation `{nodeId,prompt}`. Node events before and after confirmation have one ordered sequence.
- LangGraph checkpoint and live cancellation objects remain ephemeral, process-local runtime state. V1 does not recover or automatically retry that execution after process/runtime loss. Resume without the original checkpoint fails explicitly and the application marks the instance failed.
- Waiting for a human does not consume the active execution-duration budget. The same budget meter, call counts, accounted cost, definition, plan and Skill versions continue after resume.
- The application resumes only a PostgreSQL `paused` instance whose immutable plan is still confirmed. It can route either confirmation outcome through the original graph.
- LangGraph and checkpoint types remain confined to `packages/langgraph-runtime`; domain and application layers own protocol-neutral interrupt data and ports.

## Consequences

- A real MCP-before-confirmation e2e proves the MCP call occurs exactly once across interrupt/resume.
- Process failure cannot duplicate a side effect because no resume path reconstructs or replays a lost checkpoint.
- General user pause/cancel policies and long-pause replanning remain EP-04 concerns; this decision closes execution semantics for the DSL human-confirmation node.
