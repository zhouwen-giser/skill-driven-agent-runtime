# ADR-066: Task-Rooted Observability Navigation

## Status

Accepted on 2026-07-13.

## Context

FR-ADM-006 and NFR-OBS-001 require operators to move from a Task to its Goal, Workflow, model calls, MCP calls, runtime events, results, evaluation, and errors. These records already exist in PostgreSQL, but several query boundaries exposed only stage-wide or Server-wide data. Having the browser infer associations from timestamps or names would create unreliable presentation state.

## Decision

- Use the PostgreSQL-authoritative Task as the navigation root.
- Follow only persisted identifiers: `contextId`, `goalId`, `planId`, selected Skill identity, `task_id` on model/MCP invocations, and repository-owned result/evaluation references.
- Add read-only task filters for model invocations and MCP invocations, ordered Task runtime-event queries, and latest-instance trace lookup by Plan.
- Pass the LangGraph execution ID into LLM/MCP ports. The composition root resolves the persisted instance, Plan, and bound Task before recording those calls, so ordinary Workflow calls carry `task_id` and `context_id` rather than only direct administrative calls being traceable.
- Keep the projection compositional: existing Goal, Plan, result, evaluation, inference, and evolution APIs remain authoritative for their records.
- Allow partial evidence while a Task is in progress. Missing linked artifacts are returned as explicit API errors and displayed as unavailable; the console must not fabricate empty success records.
- Expose displayable summaries, request/response data, Token usage, duration, and errors only. Private model reasoning remains absent.

## Consequences

The console gains deterministic cross-resource navigation without a duplicate denormalized trace store. Query indexes and retention continue to follow their owning tables. A later global search/list page may reuse these filters, but it must not infer links outside persisted identifiers.
