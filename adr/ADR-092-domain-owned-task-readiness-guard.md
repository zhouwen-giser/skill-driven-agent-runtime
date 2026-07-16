# ADR-092: Domain-Owned MCP Task Readiness and Deterministic Admission Guard

## Status

Accepted on 2026-07-16.

## Context

Phase 3 must let a planner reason about Provider availability without letting Provider wire types, forecasts, or an LLM become execution authority. The same check must be repeated with resolved arguments immediately before an MCP call. A previous confirmation must not silently cover a newly restricted or more severe forecast.

## Decision

- Keep `mcp_tool` as the only MCP Workflow node and add a narrow, strict `taskExecution` DSL projection. LangGraph.js remains the only Workflow runtime.
- The domain owns Task operation semantics, timing, availability snapshots, readiness and structured risk decisions. The MCP adapter alone owns discovery metadata, the availability method and call `_meta` wire mapping.
- Planning batches availability requests by Server after structural validation. PostgreSQL stores append-only readiness and snapshot evidence, including canonical argument hashes and unresolved paths.
- The LLM selects only from a system-generated action allowlist. A deterministic guard always blocks disabled, invalid capability/contract and invalid guaranteed-reservation results; restricted and unknown results always require confirmation.
- Immediately before invocation, LangGraph resolves and freezes the actual arguments and scheduled time. The application refreshes availability with that exact snapshot. Unknown/disabled fails closed. Restricted may proceed only when the plan was confirmed, the same node was restricted during planning, and risk has not increased; otherwise a new confirmation is required.
- Availability windows are forecasts unless accompanied by a valid guaranteed `reservationRef`. SDAR never locks, pauses, preempts, runs the Provider business timer or fabricates `start_window_missed`/`deadline_reached`.
- Phase 3 projects readiness through a read-only management endpoint and Console panel. Lifecycle actions remain Phase 5/6 scope.

## Consequences

Plans and pre-call decisions have reproducible evidence and the execution boundary cannot be bypassed by a model or stale confirmation. The V1.1 `taskExecution` projection is a narrow layer on top of the merged 0063 generic Tool execution semantics and transitive Skill confirmation evaluator: readiness never replaces effect, replay, idempotency or source authority, and cannot weaken a parent/child confirmation decision.

## Rejected Alternatives

- Add an `mcp_task` node or a second execution runtime: duplicates existing MCP/LangGraph authority.
- Trust plan-time availability until execution: arguments, time and Provider state can change.
- Treat best-effort windows as reservations: misrepresents Provider authority.
- Reuse local queue timeouts as business deadlines: would fabricate Provider terminal state.
