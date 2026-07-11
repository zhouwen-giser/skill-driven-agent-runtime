# ADR-024: Outer Goal evaluation and immutable replanning

## Status

Accepted on 2026-07-12.

## Decision

- Goal evaluation and replanning are application-layer orchestration outside LangGraph. A running graph is never changed; each round references one confirmed immutable plan, one Workflow instance, and one structured evaluation.
- PostgreSQL owns the Workflow control record and ordered round records. A round persists plan/instance/version identity plus only the displayable evaluation decision, summary, and optional replan instruction—never private model reasoning.
- The fixed `goal_evaluation` Model stage receives the active Goal criteria and latest terminal Workflow instance. Its output is strict structured data with decision `achieved`, `replan`, or `unachievable`. `replan` requires an explicit instruction and other decisions forbid it.
- A replan always creates the next WorkflowDefinition version through the existing validated Planner. It is not treated as an automatic correction and does not inherit confirmation from the previous plan.
- A new replan pauses at `awaiting_confirmation` unless every named current enabled Skill explicitly sets `autoConfirmPlan=true`. An empty Skill set never auto-confirms. Continue requires repository evidence that the pending plan was confirmed.
- `maxReplans` counts newly generated plan versions after the initial plan. Zero permits the initial execution but no replan. When evaluation requests another plan at the limit, the control terminates as `replan_budget_exhausted`, the final instance is retained, and the active Goal becomes `unachievable`.
- Achieved and unachievable evaluations update the PostgreSQL-authoritative Goal status. Goal identity, context, and version are checked before every round, preventing a changed/superseded Goal from reusing an old plan or result.
- Controller failures are persisted as `failed`; callers receive the original stable error. A failed Workflow instance may still be evaluated and replanned from its persisted error/result state.

## Consequences

- FR-WF-008 and FR-WF-009 now have reproducible round, Goal-status, confirmation, budget, model, and real-MCP evidence.
- Pause/resume inside a Workflow, Task lifecycle orchestration, Goal Patch creation/invalidation, and natural-language/admin plan editing remain later increments.
- Replan exhaustion marking a Goal unachievable is the V1 fail-closed termination policy. A future alternative policy requires a superseding ADR rather than silently leaving an active Goal with no executable path.
