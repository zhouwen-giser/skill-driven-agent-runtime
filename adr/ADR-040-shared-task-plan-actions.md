# ADR-040: Shared Task-level plan actions

## Status

Accepted — 2026-07-12

## Context

FR-EXE-002 requires plan confirmation through both A2A follow-up messages and the management API, including confirm, reject, and modification, with consistent state. The A2A adapter already delegated to TaskService, while management exposed only lower-level Workflow-plan confirmation and revision endpoints. Those endpoints did not provide one authoritative Task state transition path.

## Decision

- Add `POST /api/v1/tasks/{taskId}/actions` for `confirm_plan`, `reject_plan`, and `revise_plan`.
- The management endpoint calls the same `TaskService.followUp` method used by A2A follow-up mapping. It does not duplicate transition rules in the HTTP layer.
- Natural-language revision continues to create an immutable plan version, supersede the source confirmation, bind the new plan to the Task, and return to `awaiting_plan_confirmation`.
- Confirmation operates on the Task-bound plan and moves the Task to execution only after repository confirmation. Rejection terminates the Task as canceled.
- A2A direct reads project the PostgreSQL-authoritative Task, so management actions become immediately visible through the protocol API.

## Consequences

Both interfaces now share stable validation, errors, audit events, and Task phases. Lower-level Workflow APIs remain available for administrative Workflow operations, but Task lifecycle actions use the Task endpoint.
