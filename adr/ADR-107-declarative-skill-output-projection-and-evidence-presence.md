# ADR-107: Declarative Skill Output Projection and Evidence Presence

## Status

Accepted on 2026-07-18.

## Context

ADR-100 and ADR-105 require exact child input/output mappings to become restricted Workflow data.
The first PR #5 review found that deterministic Skill Usage compilation carried `outputMappings` in
policy evidence but did not materialize them after a `skill_call`. It also passed the complete reserved
execution envelope to a child when `inputMappings` was empty. As a result, a valid child result could
fail its input Schema or never satisfy a parent evidence gate.

## Decision

- `skill_call.outputMappings` is optional, bounded declarative Workflow DSL data. Skill Usage plan
  compliance requires it to exactly match the immutable selected child policy.
- LangGraph remains the only runtime. After a child result has passed the existing child output Schema,
  the compiler copies finite JSON values along the declared safe property paths. It applies the same
  projection to immediate results and persisted external-wait continuations without replaying the child.
- An empty child input mapping references the reserved `input.skillInput`, never the surrounding
  `{ skillInput, context, evidence }` execution envelope.
- The restricted expression AST adds `exists(path)`. It returns only whether a bounded property path is
  present; it cannot evaluate code, coerce values, mutate state or turn model prose into evidence.
  Deterministic evidence gates use it only when an exact declared output mapping supplies that evidence.
- Direct mapped `evidence` objects join the existing immutable evidence read projection. Missing paths,
  non-JSON values, unsafe property names and target-shape conflicts fail closed with stable errors.
- Top-level Skill selection filters the exact version's `visibility.userSelectable` before semantic
  scoring, applicability assessment or model selection. Non-user-selectable Skills remain available
  only through their separately declared composition/internal boundaries.

## Consequences

Declared child outputs can satisfy parent evidence gates and feed later restricted bindings without a
second procedure engine or mutable Workflow graph. Immediate and resumed execution have identical
mapping behavior. Internal/composable Skills cannot leak into the top-level user-selection candidate
set. The additive DSL fields require schema, validator, compiler and contract regression evidence.

## Rejected Alternatives

- Implicit JavaScript transforms or model-authored mapping code: violates the no-dynamic-code rule.
- Treat arbitrary objects as truthy conditions: weakens the restricted expression contract.
- Store mapped evidence in a second runtime state service: duplicates Workflow/PostgreSQL authority.
- Mark every child success as evidence without copying the declared value: loses the mapping contract.
