# ADR-076: Transitive Nested Skill Confirmation

## Status

Accepted on 2026-07-16.

## Context

The v1.0.2 `skill_call` path created a real child Workflow but unconditionally confirmed its plan. A confirmed parent could therefore bypass a child Skill whose `autoConfirmPlan` policy was false. Initial Task planning also checked only the selected top-level Skill, while outer replanning inspected only directly named nodes. These paths did not provide one conservative authority for nested confirmation.

Child planning happens while the immutable parent LangGraph instance is already running. A non-auto-confirmed child must therefore persist its identity, pause the parent without invoking child Tools, project the Task as input-required, and resume the same checkpoint only after an explicit decision.

## Decision

- `TransitiveSkillConfirmationEvaluator` is the sole auto-confirm evaluator for initial Task plans, outer replans and child plans. It includes governing Skills, every direct `skill_call`, and recursively reachable `parent_child`, `depends_on` and `composition` graph relations. Missing, disabled or opted-out Skills fail closed. `alternative`, similarity and coverage relations do not grant execution authority.
- Top-level auto-confirm is allowed only when every reachable current Skill version opts in. Skill replacement remains manually confirmed even when the replacement policy opts in.
- `SkillCallWorkflowService` plans and validates the current child version, then persists `callId`, `parentPlanId`, parent instance/node, child plan, child Skill/version and confirmation status. The planned child instance identity is derived from `callId`; parent confirmation never counts as child confirmation.
- An opted-out child returns a typed confirmation request to LangGraph. LangGraph pauses with `kind=skill_confirmation`; the parent Task is projected back to `awaiting_plan_confirmation` and therefore to standard A2A `input-required`. No child MCP call occurs before the second confirmation.
- Existing `confirm_plan`, `reject_plan` and Task cancellation entry points resolve the child decision when the Task is waiting at such a checkpoint. Confirmation resumes the same in-memory LangGraph checkpoint; rejection/cancellation cannot execute the child.
- A changed child version invalidates the waiting linkage. Resuming the parent creates a fresh child plan and a fresh confirmation checkpoint. Replanned or substituted parent plans use the same evaluator and create new immutable instances/linkages.
- Migration 0057 adds `parent_plan_id` and `confirmation_status`, expands lifecycle statuses, and allows `child_instance_id`/`completed_at` to remain null while confirmation is pending. The planned instance ID is derived from `call_id`; after execution creates the instance row, the final relation stores it under the existing foreign key.

## Consequences

Nested confirmation introduces a durable pause between planning and child execution. The parent execution remains process-local and is not recoverable after process failure, consistent with the V1 runtime invariant; PostgreSQL still preserves the plan and confirmation audit.

The Skill Graph is conservative authority for statically declared execution relationships, while each dynamically generated child plan is evaluated again. This closes both initial and runtime discovery paths without pretending that non-execution relations are permissions.

Migration 0057 rollback is refused while any child relation is nonterminal, incomplete or lacks a materialized child instance. Operators must resolve or archive those waits before restoring the v1.0.4 schema.
