# ADR-044: Failure-driven Skill replacement with fresh confirmation

## Status

Accepted — 2026-07-12

## Context

FR-SKL-013 requires a failed initially selected Skill to produce an alternative plan and request confirmation again. Existing selection code could create an awaiting-confirmation replacement record, but Task execution did not retain its original selection identity and the outer controller did not consume alternative relations.

## Decision

- Persist the initial Skill selection ID on the authoritative Task.
- When a persisted failed WorkflowInstance is evaluated as `replace_skill`, resolve candidates only from enabled outgoing `alternative` Skill Graph relations.
- Persist the replacement selection record, create an immutable next Workflow version outside LangGraph, atomically supersede the failed source plan, and bind the replacement Skill/version/plan to the Task.
- Never auto-confirm a replacement plan, even when its Skill normally opts into auto-confirmation.
- A2A or management confirmation resumes the existing outer controller instead of creating a second controller.
- Continue Goal Evaluation only from a failed instance that was actually persisted; exceptions without failed execution evidence remain fatal.

## Consequences

Replacement is explainable and cannot silently switch Skills. Migration `0035_task_skill_selection` adds the Task-to-selection foreign key. The immutable failed instance and first evaluation round remain queryable after replacement succeeds.
