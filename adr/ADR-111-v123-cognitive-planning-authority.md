# ADR-111: v1.2.3 Cognitive Planning Is Advisory to the v1.2.2 Goal Runtime

## Status

Accepted on 2026-07-23. Owns KD-01, KD-07, KD-11, KD-12, KD-13 and KD-18. It extends ADR-109
without superseding its Goal, Skill, Outcome, Recovery, Business Events or terminal authority.

## Context

v1.2.3 adds task understanding, human Goal/Plan review and optional Experience-enriched planning. A
second Agent or Workflow runtime, direct Candidate injection, or a second terminal authority would make
the v1.2.2 contract ambiguous. Historical success and Capability Patterns also cannot establish current
Provider/device readiness.

## Decision

- LangGraph.js remains the only Workflow execution runtime; cognitive sessions and Skill Goal DAGs are
  immutable planning/state-machine data.
- Candidate knowledge is never visible to the formal Planner. Experience is optional advisory input and
  any timeout, invalid result, conflict or repository failure falls back to the base Planner.
- Capability Pattern is a knowledge target, not a Skill, and v1.2.3 never automatically publishes a
  Skill.
- The only handoff to v1.2.2 is a user-confirmed Goal Contract and validated, confirmed plan under the
  existing `goalId + goalVersion` lock. No external call occurs inside that lock.
- `UserGoalPlanController` remains the sole User Goal/A2A terminal authority. Workflow, Experience,
  Candidate knowledge and Capability Summary cannot commit a terminal result.

## Consequences

The cognitive Application may decorate the base planning service but cannot replace it. Formal execution
remains fully operable with every v1.2.3 Experience feature disabled or failed. Architecture checks reject
reverse imports from v1.2.2 authority modules into cognitive implementation modules.

## Rejected Alternatives

- A Mastra/Python or research-agent sidecar: violates the single runtime/process boundary.
- Direct Candidate prompting: bypasses promotion and contaminates formal planning.
- Capability Pattern to Skill auto-publication: crosses the existing Skill authoring authority.
