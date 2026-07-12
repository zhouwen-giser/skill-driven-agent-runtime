# ADR-045: Automatic task-scoped Temporary Skill execution

## Status

Accepted — 2026-07-12

## Context

FR-SKL-014 requires execution through an available MCP Tool when no formal Skill satisfies a Goal. The prior Temporary Skill lifecycle proved isolation and expiration, but creation was only an administrative operation and was not connected to Task planning or LangGraph execution.

## Decision

- A fixed schema-constrained `skill_authoring` model decision selects only from enabled, currently registered MCP Tools. The application rejects invented server or Tool references.
- The selected Tool is wrapped in a domain-owned Temporary Skill scoped to one Task and context. It is persisted separately from formal Skills and bound to the authoritative Task.
- Planning receives the Temporary Skill contract and emits ordinary validated Workflow DSL. LangGraph.js remains the only executor.
- Temporary Skill plans always require explicit confirmation. No MCP call occurs before confirmation.
- Successful Task finalization atomically expires the Temporary Skill and persists its Experience. Temporary Skills never appear in the formal registry or dynamic Agent Card.
- Repeated successful Experiences may create only an `awaiting_simulation` candidate. ADR-015 and EP-05 continue to govern simulation and publication.

## Consequences

The capability gap now has a reproducible end-to-end path without introducing a second runtime or allowing model-generated code. Migration `0036_task_temporary_skill` adds an exclusive Task reference to either a formal or Temporary Skill. FR-SKL-015 remains open until simulation and governed publication are implemented.
