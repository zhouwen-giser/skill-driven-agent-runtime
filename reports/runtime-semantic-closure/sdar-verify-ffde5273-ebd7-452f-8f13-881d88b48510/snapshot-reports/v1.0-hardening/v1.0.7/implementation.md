# v1.0.7 Implementation

Date: 2026-07-16

`SkillInputResolutionService` gathers bounded priority-ordered request evidence, invokes the fixed structured model stage, overlays explicit metadata, validates the candidate with the selected Skill version's JSON Schema and saves one immutable domain record. Failed model decisions are audited as failed records; schema-invalid decisions become durable input-required state instead of entering planning.

`PlanPreparationProcessor` resolves formal Skill input after selection and resumes the same Task after v1.0.3 supplementary input. The plan binds its exact resolution ID to AgentTask; `TaskService` loads that immutable record and rechecks Task, Goal version and Skill version when execution starts. `WorkflowControllerService` retains the same structured value across ordinary replans. Goal Patch preflights resolution against the proposed new Goal version before it invalidates old authority.

`PostgresSkillInputResolutionRepository`, migration 0059, management endpoints and Console links provide durable history and operational evidence. Migration 0060 adds the composite plan-binding authority and guarded rollback. Provider route and Prompt configuration use the existing model runtime; LangGraph remains the only Workflow executor.

Feature commit/tag: `9bf6ba3` / `v1.0.7`.
