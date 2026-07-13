# ADR-071: Bounded Semantic MCP Recovery

## Status

Accepted on 2026-07-13. This supersedes the execution-exception choice set in ADR-027 while preserving its fixed-stage LLM decision boundary.

## Context

FR-MCP-012 requires an LLM to decide whether a failed Tool call should retry, change arguments, use another Tool, invoke another Skill, or terminate. A generic `goto` target was replayable but did not identify these semantics, and an unconstrained model-selected target would violate the immutable Workflow and Tool-registration boundaries.

## Decision

- The Workflow domain owns four recovery actions: `retry`, `change_arguments`, `alternative_tool`, and `invoke_skill`. Termination remains an always-available model decision.
- A validated `error_handler` may declare immutable `recoveryOptions`. Every option identifies an existing Workflow node, has a displayable description, and has a `maxAttempts` bound from 1 through 10.
- Retry targets the handled MCP node. Argument change targets the same registered Tool with different schema-valid arguments. Alternative Tool targets a different registered MCP Tool node. Skill recovery targets an enabled, input-valid `skill_call` node.
- The fixed `execution_decision` model stage receives only currently unexhausted options. Its structured output must exactly match an offered action and target; invented or exhausted choices fail closed.
- LangGraph.js remains the only executor. Recovery routes through the already compiled immutable graph, records a deterministic action/target attempt counter, and never mutates the running Workflow.
- Existing `terminate`/`continue`/single-target `goto` handlers remain compatible. Semantic MCP recovery uses `goto` plus `recoveryOptions` and cannot combine them with a singular `gotoNodeId`.

## Consequences

Exception decisions are replayable as structured outputs plus recovery counters, and all executable arguments, Tool references, and Skill inputs were validated before confirmation. The model can choose among safe alternatives but cannot create a node, change arguments at runtime, register a Tool, exceed an attempt bound, or invoke a second workflow runtime.

Rollback removes `recoveryOptions` from affected Workflow definitions and returns MCP exception handling to the legacy constrained strategy set; no database migration is required.
