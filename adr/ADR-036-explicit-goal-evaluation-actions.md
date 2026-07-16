# ADR-036: Explicit Goal-evaluation actions

## Status

Accepted — 2026-07-12

## Context

FR-RST-004 requires every terminal Workflow round to be evaluated rather than equating Workflow success with Goal achievement. FR-RST-005 requires explicit decisions for missing information, plan adjustment, replacement Skills, additional Skills, and termination. The earlier outer controller persisted only `achieved`, generic `replan`, or `unachievable`, so evidence could not distinguish the required actions.

## Decision

- The fixed `goal_evaluation` model stage is the sole final decision maker and returns one strict, displayable action: `achieved`, `request_input`, `adjust_plan`, `replace_skill`, `invoke_additional_skill`, `capability_gap`, or `unachievable`.
- Planning actions require an `actionInstruction`. Input requests require a clear `question`. Capability gaps require a human-readable missing capability and suggested tool contract. Fields belonging to another action are rejected.
- `adjust_plan`, `replace_skill`, and `invoke_additional_skill` use the existing outer controller to create a new immutable Workflow version. They remain subject to `maxReplans` and fresh confirmation unless every resolved Skill explicitly opts into automatic confirmation.
- `request_input` persists full evidence and stops the controller in an explicit waiting state. `capability_gap` also persists full evidence and starts no further node, but ADR-081 supersedes its waiting semantics with a terminal WorkflowControl/Task outcome.
- PostgreSQL persists the complete structured evaluation as JSON in addition to indexed decision and summary columns. No model-private reasoning is requested or stored.

## Consequences

The system can audit why a Goal continued, waited, changed Skills, or terminated without adding a second runtime or mutating an executing LangGraph graph. A2A Task-level projection of capability-gap evidence remains a separate FR-RST-006 increment and is not implied by this decision.
