# G03 User Goal Contract and Skill Goal DAG Planning

## Summary

Status: **completed**. AgentTask preparation now persists a versioned `UserGoalCompletionContract`
and a validated `UserGoalPlan` before Skill selection. The structured `goal_planning` stage has two
bounded attempts and fails closed without persisting a partial plan.

## Implementation and invariants

- `UserGoalPlanningService` invokes the model outside the Goal CAS gate and validates the returned
  Goal/dependency/capability/criterion/effect/evidence/artifact/assumption/coverage data.
- `SkillGoalPlanValidator` enforces the frozen bounds, DAG acyclicity, known dependencies, 100% required
  criterion coverage, plan/contract version identity and completed-effect/forbidden-replay constraints.
- Skill, Tool, Provider, Workflow and execution identifiers are rejected from planning data.
- Revisions are immutable and persist `sourcePlanId`, `revisionKind`, version and supersede state. Goal
  Patch invalidates the previous plan and carries forward no-replay authority.
- Task preparation invokes planning before selection; no direct AgentTask-to-Skill-selection path is
  available.

## Validation

`packages/application/test/user-goal-planning.unit.test.ts` passed 5 cases: valid DAG-before-selection,
cycle correction, injected-ID fail-closed, timeout fail-closed and immutable revision/no-replay.
`packages/domain/test/user-goal-runtime.unit.test.ts` and the full 59-test E2E suite also passed.

## Acceptance

AC-010 through AC-015 are verified. Required criterion coverage is 100%; a plan contains requirements,
not selected execution capability.

## Reproduction

```text
pnpm exec vitest run --project unit packages/domain/test/user-goal-runtime.unit.test.ts packages/application/test/user-goal-planning.unit.test.ts
pnpm test:e2e
```

