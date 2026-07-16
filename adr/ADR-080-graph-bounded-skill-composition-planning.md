# ADR-080: Graph-bounded Skill composition planning

## Status

Accepted on 2026-07-16.

## Context

The Skill Graph already stores six domain relation types, but initial Workflow planning used only the selected Skill. Graph edges affected alternative replacement and transitive confirmation, so a model could invent an unrelated `skill_call`, while a valid dependency or composition edge was invisible to its initial decision. The runtime needs auditable composition without exposing every registered Skill or turning graph traversal into a second executor.

## Decision

- The existing `composition` relation is the repository's equivalent of the task package's composable semantic. No seventh enum is introduced. Initial composition traverses `parent_child`, `depends_on`, `input_output_match`, `composition` and `capability_coverage`; `alternative` remains replacement-only.
- The Skill domain owns `SkillVersionSnapshot` and `SkillCompositionContext`. The context records the exact selected/current related versions, traversed relation snapshots, allowed child IDs and a displayable deterministic summary. The model sees this bounded context and retains final choice among admitted children.
- `SkillCompositionPlanner` follows only outbound reachable graph edges, rejects cycles across relation kinds, requires current enabled versions and caps traversal at eight levels, 32 related Skills and 128 accepted relations. Indexed repository reads filter by source/relation kind and request only the remaining bounded capacity; composition never loads the entire graph first.
- Schema direction is relation-specific: `depends_on` requires target output to satisfy source input; `parent_child` and `capability_coverage` require source input to satisfy target input; `input_output_match` and `composition` require source output to satisfy target input. Compatibility is a conservative restricted JSON-Schema structural check; runtime still validates actual child input/output with the full current schemas.
- Workflow planning persists the context on every plan and attempt and validates each generated `skill_call` against its allowed IDs. Explicit capability-gap IDs are a separate persisted allow-list. Plans without either authority cannot introduce `skill_call` nodes; historical pre-0062 plans remain readable.
- Every generated, inherited and persistence-loaded context revalidates unique identities, root reachability, acyclicity and the same graph bounds. Skill schemas and relation metadata are detached finite JSON snapshots capped at depth 64.
- Replans and revisions inherit the immutable context unless Skill replacement supplies a new exact root. Dynamically planned child Workflows build their own context from the child Skill, preserving multi-level composition and v1.0.5 confirmation.

## Consequences

Initial planning exposes only graph-bounded, schema-compatible Skills and records why they were available. Alternative Skills cannot leak into initial composition, unrelated calls fail before plan persistence, and execution can recheck persisted authority. LangGraph remains the only Workflow executor; graph traversal supplies planning data and never invokes a Tool or Skill.
