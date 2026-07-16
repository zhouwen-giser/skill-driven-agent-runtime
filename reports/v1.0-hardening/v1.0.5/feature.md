# v1.0.5 Feature Review

Date: 2026-07-16

## Outcome

Nested Skills now enforce their own confirmation policy. Parent confirmation is never inherited by a child plan, and top-level auto-confirm is granted only when the governing Skill, every directly planned Skill and every recursively reachable execution Skill opts in.

## Runtime evidence

- ADR-076 defines one transitive evaluator used by initial Task planning, outer replanning and child planning.
- An opted-out child persists exact parent plan/instance/node, child plan, child Skill/version and confirmation status before any child execution.
- LangGraph emits a typed `skill_confirmation` checkpoint. The Task returns to `awaiting_plan_confirmation`, projected as standard A2A input-required.
- `confirm_plan` confirms only the bound child plan and resumes the same parent node. `reject_plan` and Task cancellation reject the waiting child.
- A current child version change invalidates the waiting record and produces a fresh plan/checkpoint.
- Migration 0057 preserves final child-instance referential integrity while allowing the confirmation lifecycle to precede instance creation.

## Known boundary

The paused LangGraph checkpoint is process-local and is not reconstructed after process failure, matching the V1 non-recovery invariant. PostgreSQL retains the plans and confirmation audit.

Feature commit/tag: `6decc5d` / `v1.0.5` (published and remotely verified).
