# ADR-100: Bounded Recursive Skill Usage Composition

## Status

Accepted on 2026-07-17.

## Context

The existing Skill Graph and `SkillCompositionPlanner` already own composition relationships. V1.2
needs fixed dependencies and dynamic capability slots with a stricter usage-specific recursion budget.

## Decision

- Extend the existing Skill Graph, relation repository and planner. No second relation graph or
  application-owned workflow scheduler is admitted.
- Every root, fixed dependency, dynamic candidate and selected child is an exact current enabled Skill
  version admitted by an existing relation. Slot choices must belong to the generated candidate set.
- Input/output mappings are declarative bounded property paths and must be JSON-Schema-compatible.
- Parent and children consume one shared budget. Default usage depth is 3, hard maximum is 5, expanded
  Skills are capped at 32 and plan nodes at 128.
- Cycles, duplicate expansion, disconnected topology, stale versions, duplicate choices/edges,
  incompatible mappings and budget contradictions fail closed before planning.
- Plans and candidate sets are recursively immutable. Replanning creates a new plan outside execution.
- Failure policies are closed: `fail_fast`, `recoverable`, `optional` and `degraded`; degraded requires
  explicit missing effect or evidence.

## Consequences

Recursive reuse is deterministic and auditable without changing the generic depth-8 Skill Graph or
depth-8 Skill-call safety limits. The stricter usage budget is independent and cannot be diluted by a
child.

## Rejected Alternatives

- Per-child depth reset: permits unbounded recursive expansion.
- Model-invented candidates or relations: bypasses catalog authority.
- Reusing generic depth 8 as the usage limit: contradicts the frozen V1.2 hard maximum.
