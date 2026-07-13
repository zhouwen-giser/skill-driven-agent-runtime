# ADR-025: Immutable plan revision and confirmation invalidation

## Status

Accepted on 2026-07-12.

## Decision

- Natural-language A2A edits and administrator DSL/DAG edits share the domain Workflow validator and create a new immutable WorkflowDefinition version. They never mutate a running graph or persisted definition.
- Every revision preserves Workflow and Goal identity, increments the Workflow version exactly once, records `sourcePlanId` and a revision kind, and starts at `awaiting_confirmation`.
- PostgreSQL atomically changes an active source plan from `awaiting_confirmation` or `confirmed` to `superseded` while inserting the revision. A superseded plan cannot be reconfirmed or executed.
- Natural-language edits pass a displayable operation, instruction, and source definition to the fixed `workflow_planning` stage. Model output remains JSON-Schema-constrained data and passes the same strict validator.
- Administrator DAG edits use the canonical WorkflowDefinition serialization produced by the repository-owned visual editor. Node names, entry/exit markers, and edge topology/outcomes edit the same restricted JSON draft and preserve type-specific node configuration. The server does not accept executable callbacks, source code, or a second graph runtime.
- An A2A Task must be bound to a real persisted plan before `revise_plan` or `confirm_plan`. Revision rebinds the Task to the new plan; confirmation invokes the real Workflow confirmation service before the Task enters execution.

## Consequences

- Editing invalidates old confirmation and intermediate plan authority without deleting audit history.
- Concurrent or repeated edits fail closed because only one transaction can supersede an active source.
- FR-WF-010 has unit, PostgreSQL integration, management contract, and same-process A2A/admin e2e evidence.
- EP-06 implements the visual React DAG editor as a data-only projection over this validated server contract. Visual changes do not mutate the persisted source Plan or a running Workflow instance; validation and immutable revision remain explicit operations.
