# ADR-021: Workflow planning correction and confirmation inheritance

## Status

Accepted on 2026-07-12.

## Decision

- Workflow Planner sends the authoritative Workflow JSON Schema to the fixed `workflow_planning` Model stage.
- Every raw candidate and structured validation error is persisted before another attempt.
- Validation errors, not private reasoning, are fed to the same configured model. Correction is bounded by an injected maximum; exhaustion persists a failed plan and fails the operation.
- Validated Workflow identity and Goal version must exactly match the requested immutable version.
- Initial plans always remain `awaiting_confirmation`, including corrected initial plans.
- Confirmation can be inherited only when repository evidence identifies a source plan with `confirmed` status. A caller-provided boolean cannot auto-confirm.
- Repair creates a new WorkflowDefinition/version and never mutates the source or a running graph.

## Consequences

FR-WF-004 has replayable correction evidence. FR-WF-005 confirmation inheritance is modeled and unit-tested, but execution without a second confirmation remains incomplete until the compiler/execution increment consumes confirmed records.
