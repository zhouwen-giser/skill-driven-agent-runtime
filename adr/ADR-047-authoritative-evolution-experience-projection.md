# ADR-047: Authoritative Evolution Experience projection

## Status

Accepted — 2026-07-12

## Context

FR-EVO-001 requires each successful task to become Experience rather than a formal Skill and requires the Experience to include Goal, Tool combination, Workflow, result and evaluation. These records already existed in separate authoritative modules but were not replayable as one evolution unit.

## Decision

- `EvolutionExperience` is a domain-owned immutable projection of one evaluated Workflow control round.
- The controller records it immediately after persisting the Goal Evaluation round, before projecting terminal Task state.
- It contains the displayable Goal snapshot, immutable validated Workflow DSL, actual Skill versions, direct MCP Tool references, input, result/errors, structured evaluation, success classification and duration.
- PostgreSQL is authoritative. A unique `(control_id, round_index)` constraint makes collection idempotent; foreign keys retain Task, context, Goal, control and WorkflowInstance lineage.
- Management APIs expose individual Experience and Goal/Skill histories. No private reasoning is stored; the evaluation contains only the structured decision and summary.
- Experience creation never publishes, disables or changes a Skill. Evolution remains a separate threshold and validation process.

## Consequences

Successful and failed evaluated rounds can be inspected and selected for later replay without reconstructing them from logs. Skill-call internals remain represented by actual SkillVersion references; direct MCP nodes expose their Tool combination. Full historical replay is a subsequent FR-EVO-005 increment.
