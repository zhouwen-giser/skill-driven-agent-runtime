# v1.0.5 Bug-fixed Review

Date: 2026-07-16

## Findings and fixes

- Plan actions previously ran before Task-phase validation, so a confirmation sent to an already canceled Task could mutate confirmation state before the domain transition failed. Decisions are now serialized per Task and rejected before side effects unless the Task is awaiting confirmation.
- A duplicate child confirmation could fall through to the outer Workflow start path after the first resume removed the active pause. Confirmation now returns an explicit `task_plan` or `nested_skill_plan` target, so nested decisions never start a second outer execution.
- Checkpoint validation previously omitted parts of the child identity, and resume trusted a once-confirmed plan. Both decision and resume now require exact parent/child metadata and current Skill/immutable-plan authority; changed or superseded authority is invalidated.
- Version invalidation can immediately yield a second pause. Workflow waiting now detects checkpoint changes and reprojects each fresh child confirmation instead of waiting invisibly for terminal state.
- Task cancellation is persisted before a child checkpoint is released. Unified wait-timeout cancellation also releases nested waits, processing every expired Task and surfacing aggregate failures.

## Review outcome

Concurrent duplicate decisions execute one plan action. Canceled parents reject later confirmation. Superseded plans and changed Skill versions cannot execute under stale authority. Real A2A/MCP evidence observes a fresh v2 checkpoint and no v1 MCP call after version drift.

Feature commit/tag: `6decc5d` / `v1.0.5`.

Bug-fixed commit/tag: reconciled after publication.
