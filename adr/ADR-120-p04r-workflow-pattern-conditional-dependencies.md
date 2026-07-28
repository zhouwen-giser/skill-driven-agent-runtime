# ADR-120: WorkflowPattern V1.2 Carries Conditional Dependencies

## Status

Accepted for P04R.

## Context

The P04R compiler contract requires ordinary conditional dependencies to compile to an optional
Skill Goal edge with a bounded `ConditionExpression`. The initial WorkflowPattern V1.2 draft only
allowed `direct_follows`, `precedes`, and `parallel`, so only Recovery-specific conditions could be
synthesized. That made the producer contract unable to represent a required P04R input.

## Decision

`DependencyPattern.relation` adds `conditional`. A conditional dependency must carry exactly one
validated `ConditionExpression`; other relation kinds must not carry one. The Plan Template compiler
preserves it as an `optional` dependency with the same condition.

Direct/precedes evidence still compiles to a required edge. Parallel evidence still compiles to a
parallel-group constraint and no ordering edge. A parallel relation combined with any ordering or
conditional relation for the same unordered Activity pair is a hard conflict, including transitive
ordering paths.

The canonical WorkflowPattern V1.2 schema hash changes to
`a81cd287ea6d035e1d668d4ea17d4987a9789a10a6ec0744f64d8065951d2e11`. This is a P04R contract
correction before P03/P04 handoff closure; it does not change the frozen P00-P02 baseline.

## Consequences

- P03 and persistence can round-trip a normal conditional dependency without an SDK type crossing
  the domain boundary.
- P04 can compile both ordinary conditional branches and bounded Recovery conditions.
- P05 and the Shared Interface Registry must consume the corrected WorkflowPattern V1.2 hash.
- Existing V1.1 evidence remains historical and is not regenerated.
