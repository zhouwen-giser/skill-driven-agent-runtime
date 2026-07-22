# G04 Skill Goal Scheduler, Outcome Specification and Attempt

## Summary

Status: **completed**. Skill Goals are the execution unit; only dependency-ready Goals can create a
dispatch intent and every enabled Skill version owns an immutable `SkillOutcomeSpecification`.

## Implementation and invariants

- Skill schema, formal packages, golden fixtures and both bundled Skills require outcome effects,
  evidence, artifacts and policy metadata; publication rejects a missing specification.
- `SkillGoalScheduler` commits the dispatch intent with Goal CAS before doing selection/input work
  outside the lock.
- Compatibility admission covers capability, effect, evidence, artifact and policy requirements.
- `SkillExecutionContract` and `SkillAttempt` bind the exact Goal, Skill version and Workflow; the
  database permits only one active attempt per Skill Goal.
- At most four disjoint-effect Goals dispatch in parallel. Conflicting or unknown effects serialize
  conservatively.

## Validation

The scheduler suite passed 5 cases covering readiness, post-commit external work, bounded safe
parallelism, conflict serialization, the compatibility matrix and duplicate-dispatch CAS. PostgreSQL
integration proved exactly one active attempt under a race and successor activation after an
authoritative non-terminal Skill Goal outcome. Skill package contract tests inventory every enabled
Skill.

## Acceptance

AC-005 and AC-020 through AC-025 are verified.

## Reproduction

```text
pnpm exec vitest run --project unit packages/application/test/skill-goal-scheduler.unit.test.ts
pnpm exec vitest run --project integration packages/persistence-postgres/test/user-goal-runtime.integration.test.ts
pnpm test:contract
```

