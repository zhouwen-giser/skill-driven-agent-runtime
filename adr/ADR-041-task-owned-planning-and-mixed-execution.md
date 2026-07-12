# ADR-041: Task-owned planning and mixed execution

## Status

Accepted — 2026-07-12

## Context

FR-EXE-001 requires every executable Task to own a generated plan and to stop before execution unless the selected immutable Skill version opts into automatic confirmation. FR-EXE-003 requires short synchronous completion and return-immediately Task execution to converge on the same authoritative result. Previously, tests attached plans administratively and execution was not connected to the submitted Task.

## Decision

- Persist the selected Skill identity and generated plan identity on the authoritative Task.
- Generate the initial immutable Workflow DSL after Goal formulation and Skill selection, using the same strict planner and validator as administrative planning.
- Leave ordinary Skills at `awaiting_plan_confirmation`; confirmation through either A2A or management starts one outer Workflow Controller.
- Confirm and execute immediately only when the selected Skill version has `autoConfirmPlan=true`.
- Project controller input, capability-gap, achieved, unachievable, and processed-result outcomes back onto the same Task.
- A paused Workflow Controller waits for the persisted instance to resume before Goal evaluation. Running state is not reconstructed after process failure.
- Both synchronous and return-immediately requests read the same PostgreSQL Task and processed result; transport waiting behavior does not create a second execution path.

## Consequences

No MCP or other Workflow node can run before the Task-bound plan is confirmed. Task confirmation now means execution, rather than merely changing a status flag. Tests and administrative callers must not start the same plan separately. Selected Skill identity requires migration `0033_task_selected_skill`.
