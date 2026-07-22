# G05 Layered Outcomes and Single Terminal Authority

## Summary

Status: **completed**. Task, Skill Goal and User Goal achievement are judged independently. Provider or
Workflow terminal state is evidence only; `UserGoalPlanController` is the sole product authority that
can commit a User Goal/A2A terminal projection.

## Implementation and invariants

- `TaskGoalJudge`, `SkillGoalJudge` and `UserGoalJudge` use deterministic rules before bounded semantic
  evidence and require explicit effect/evidence references.
- A completed Provider Task or Workflow cannot imply Goal achievement; a failed execution may still
  satisfy a contract when authoritative effects prove it.
- Low-confidence or unresolved semantic evidence fails closed and cannot yield `achieved`/`none`.
- `UserGoalPlanController` supplies authority metadata and sends all three judgments to the atomic
  terminal transaction. Workflow control produces `WorkflowExecutionOutcome` and delegates judgment.
- Database uniqueness/CAS and stale-worker guards leave one terminal outcome under concurrent retries.

## Validation

The layered judge suite passed 4 false-achieved/coverage/confidence cases. The controller suite passed
3 authority, working-state and fail-closed cases. Existing PostgreSQL terminal integration tests cover
concurrent commit, rollback atomicity, stale workers and conflicting retries. Architecture verification
passed with the controller as the only application terminal authority.

## Acceptance

AC-030 through AC-037 are verified. False-achieved cases: 0.

## Reproduction

```text
pnpm exec vitest run --project unit packages/application/test/outcome-judges.unit.test.ts packages/application/test/user-goal-plan-controller.unit.test.ts packages/application/test/workflow-controller.unit.test.ts
pnpm test:integration
pnpm verify:architecture
```

