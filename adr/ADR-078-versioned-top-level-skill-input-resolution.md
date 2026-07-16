# ADR-078: Versioned Top-Level Skill Input Resolution

## Status

Accepted on 2026-07-16.

## Context

Formal Skills already publish an `inputSchema`, but the top-level A2A Task path previously passed a generic request envelope into planning and execution. Only child `skill_call` inputs were independently schema-validated. This allowed planning and MCP binding to proceed without a durable, version-specific top-level input decision and made missing fields, supplementary answers and Goal Patch behavior ambiguous.

The resolution must combine request evidence without making long-term Memory authoritative for live device state. It must remain a fixed structured model decision, preserve PostgreSQL authority, and feed the existing single LangGraph runtime rather than introduce another executor or executable expression mechanism.

## Decision

- The Skill/Task domain owns immutable `SkillInputResolutionRecord` evidence. Each record identifies the Task, Goal version, exact enabled Skill version, structured candidate, unresolved fields, cited source references, decision summary, status and creation time.
- `SkillInputResolutionService` runs after formal Skill selection and before Workflow planning. It invokes the fixed `skill_input_resolution` ModelStage with a structured response schema and the Task identity, so normal Provider routing, Prompt versioning and model invocation audit apply.
- Evidence is presented in this strict priority: A2A metadata structured input, raw request text, Goal Contract, same-context processed data, v1.0.3 supplementary input and long-term Memory evidence. The canonical metadata key is `structured_input`; `sdar_structured_input` is accepted as a compatibility alias, while the canonical key wins if both are present.
- Explicit metadata is overlaid after the model decision so the highest-priority value cannot be displaced. Long-term Memory is labeled non-authoritative evidence and may not establish live device truth.
- The resolved candidate must pass the selected Skill version's `inputSchema`. Missing or invalid required fields create an `input_required` record and a durable v1.0.3 Task input request. A follow-up response creates another immutable resolution on the same Task before planning continues.
- A resolved formal Skill value becomes the Workflow initial input directly. `requestText` and request metadata remain on the AgentTask as auxiliary evidence but are not wrapped into the execution value. Temporary Skills retain their existing legacy envelope until their own formal-input contract is introduced.
- WorkflowControl retains the resolved value for ordinary replans. Goal Patch invalidates the old execution state and runs resolution again against the new Goal version before creating its fresh-confirmation plan.
- Child Skills keep their existing independent runtime input validation and confirmation boundaries. No parent resolution grants child input authority.
- Migration 0059 adds PostgreSQL history, fixed-stage route support and the new Task input-request source. Management API and Console expose resolution history and stage configuration.

## Consequences

Every top-level formal Skill execution now has reproducible input authority tied to exact Goal and Skill versions, and MCP arguments can bind from a schema-valid structured initial value. Missing data pauses through the existing durable continuation mechanism without a second Task or Workflow runtime.

Model extraction remains a decision over bounded evidence, not a source of live world state. The runtime still depends on MCP Tools for current device facts. Resolution records are append-only; later answers and Goal versions create new records rather than mutating old evidence.
