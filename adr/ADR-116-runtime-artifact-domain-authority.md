# ADR-116: Runtime Artifact Domain authority and bounded pure-data contracts

## Status

Accepted for SDAR v1.3 P01/G01.

## Context

P01 freezes the top-level Runtime Artifact interfaces but leaves several nested shapes to the shared
design compendium. The repository already has authoritative Goal, Skill, Workflow, Outcome,
Knowledge, and cognitive modules. Artifact definitions must become reusable planning data without
becoming a second workflow runtime, Skill registry, Goal terminal authority, or executable-code
surface.

The P01 contract also requires TypeScript, Zod/AJV, JSON Schema, and golden fixtures to agree, while
Domain may not import Zod, AJV, database, SDK, runtime, or UI dependencies.

## Decision

- `packages/domain/src/compiler/` is the sole owner of Runtime Artifact types, immutable factories,
  canonical pure-data serialization, and lifecycle transition legality.
- `CompiledArtifact` implements all frozen fields without aliases or renaming. Its five definition
  variants are selected by `artifactType` and validated as an exact pair.
- Nested structures not separately frozen by the interface registry use the smallest bounded
  pure-data contracts supported by the v1.3 design compendium. In particular, the Plan Template
  nested contracts are the exact shared P04 consumer shapes rather than locally invented aliases:
  parameter definitions carry a bounded schema, required flag, single allowed source, trust level,
  and default policy; node and recovery capability requirements are identifier arrays; assumptions
  are identifier arrays; dependencies carry key, predecessor, successor, predicate and optional
  condition; completion carries title, description, criteria, evidence and artifact requirements;
  recovery carries trigger, capability identifiers, patch template, application bound and replay
  policy:
  - capability and policy references contain stable identifiers and optional/minimum pinned versions;
  - patterns and structured hints are declarative strings/operators, never regular-expression or
    source-code objects;
  - plan graphs contain immutable node/dependency templates, parameter bindings, completion
    templates, and bounded recovery patches;
  - case fingerprints, adaptations, failure boundaries, and outcome summaries are declarative
    structures with finite arrays and bounded JSON values;
  - model budgets contain finite non-negative token, latency, and cost ceilings.
- Recursive `JsonValue` and `ConditionExpression` data are bounded by maximum depth, collection size,
  object member count, key length, and string length. Undefined, functions, symbols, bigint,
  non-finite numbers, cyclic objects, prototypes, and dangerous keys are rejected.
- The lifecycle is an immutable state machine. `discovered → candidate → validating →
awaiting_approval → active → revalidating` is the primary spine. Reviewed rejection, deprecation,
  and archival transitions are allowed only by the explicit Domain transition table. Entering
  `active` requires both a validation summary reference and transition evidence that validation
  passed and approval was recorded. The factory applies the same evidence rule to direct
  construction, so callers cannot bypass the transition function by supplying `status: active`.
- A lifecycle transition returns a new frozen Artifact snapshot. Definition, applicability,
  dependency snapshot, lineage, validation, approval, and active-pointer state are never mutated in
  place. P01 does not implement the later active-pointer repository.
- `ArtifactLineage` is authoritative domain data about origin. `ArtifactRuntimeBinding` is an
  immutable but rebuildable projection record and never proves activation or execution success.
- Zod lives in `packages/schemas`; AJV remains isolated in `packages/json-schema-adapter`; portable
  JSON Schema lives under `schemas/v1.3`. The adapter registers the documented
  `x-sdar-max-depth`, `x-sdar-max-condition-depth`, `x-sdar-max-condition-nodes`, and
  `x-sdar-unique-key` validation keywords plus `x-sdar-valid-plan-template` graph/cross-reference
  validation so bounded recursive data, keyed uniqueness, and Plan DAG semantics have the same
  acceptance boundary as Domain and Zod. Cross-validator golden and negative tests guard drift.
- Artifact Domain may not import or call Skill runtime, MCP, Provider, Console, LangGraph, queue,
  database, application service, HTTP, or adapter code. LangGraph.js remains the only workflow
  executor and receives compiled data only in a later package.

## Consequences

P01 provides a deterministic, serializable contract that later persistence and compiler packages can
consume without inheriting SDK or execution authority. The stricter bounded-data rules reject some
otherwise valid JavaScript objects intentionally; active definitions are portable data, not an
extension mechanism. Later packages may add repositories, compiler outputs, and active-pointer
transactions behind their own Ports and ADRs, but may not relocate or duplicate this Domain
authority.

Schema modules duplicate structural declarations in different validation technologies. Golden and
negative cross-validator tests, frozen-field metadata, and architecture checks make that duplication
observable and fail closed.

## Rejected alternatives

- Store definitions as `Record<string, unknown>`: violates the active-definition constraint and
  permits schema/runtime drift.
- Put Zod or AJV directly in Domain: introduces an external validation runtime into the core layer.
- Make Artifact execute Skill/MCP calls or construct LangGraph graphs: creates a second execution
  authority and breaks adapter boundaries.
- Treat Runtime Binding or a file as the active Artifact authority: confuses a rebuildable projection
  with durable business truth.
- Reuse cognitive Knowledge status as Artifact status: merges two independently frozen lifecycle
  authorities and makes later evolution ambiguous.
