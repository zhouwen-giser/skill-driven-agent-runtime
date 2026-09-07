# G06 Progress, Recovery, Supersede and No Replay

## Summary

Status: **completed**. Recovery is bounded, persisted and ordered by User Goal → Skill Goal → Task Goal
→ remote reconciliation → budget. It cannot repeat an unchanged strategy or replay an authoritative
completed effect.

## Implementation and invariants

- Progress vectors classify `complete`, `progressing`, `stalled` and `regressing`; no percentage is an
  achievement authority.
- Task, Workflow, Attempt and Plan budgets plus strategy fingerprints are persisted in PostgreSQL.
- `UserGoalRecoveryService` is the common recovery path for control outcomes and Business Event impact.
- Achieved User/Skill/Task Goals stop recovery at their level. An uncertain remote Task is reconciled
  before replacement or retry.
- Replanning supersedes immutable Workflow/Attempt/Plan versions and only covers remaining criteria.
  Append-only completed effects and forbidden-replay records gate every strategy.
- Process/Redis loss reconstructs dispatch from PostgreSQL; it does not reset budgets or confirmed
  effects.

## Validation

The recovery suite passed progress classification, authority order, same-strategy, no-replay and budget
exhaustion cases. PostgreSQL integration passed persisted restart budget, completed-effect invalidation,
active-attempt race and successor activation cases. E2E passed stale Skill-version recovery and
immutable replacement confirmation.

## Acceptance

AC-040 through AC-048 are verified.

## Reproduction

```text
pnpm exec vitest run --project unit packages/application/test/progress-recovery.unit.test.ts
pnpm exec vitest run --project integration packages/persistence-postgres/test/user-goal-runtime.integration.test.ts
pnpm test:e2e
```

