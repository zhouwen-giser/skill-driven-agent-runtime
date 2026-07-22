# G02 Clean Baseline, Domain and Repository Report

Status: implementation and focused verification complete; Goal handoff remains open with the Master
Goal until G01 terminal-authority replacement is landed.

## Baseline and safety

- Baseline: `infra/postgres/baseline/0001_sdar_v1_2_2_baseline.sql`
- SHA-256: `753b3dbd66934404fa002dad246321fb6c2086277180aa7674f9e87199b1ef9a`
- Seed SHA-256: `6b13a57d769f6f881e2c081465977df0925868a435e213246f327a55672cb8ba`
- Runtime accepts an empty database or the sole `v1.2.2_clean_slate_baseline` marker. Any other table or
  migration ledger fails with `SDAR_V122_CLEAN_DATABASE_REQUIRED`.
- `db:reset:v1.2.2` requires `SDAR_ENV=development|test`, confirmation value `v1.2.2`, and a disposable
  database name prefix. The verification executes both rejection guards and a real disposable reset.

## Domain and schema

The baseline adds normalized authorities for User Goal contracts/plans, Skill Goals/dependencies,
Skill Outcome specifications, execution contracts/attempts, Task/Skill/User outcomes, progress,
completed effects, recovery decisions, Business Event subscriptions/inbox/relation/impact/incidents,
and Workflow/Remote Task Skill Goal/Attempt linkage. JSONB inputs are type-checked and capped at 256 KiB.

The Domain freezes the G02 identifiers/statuses and the limits 16/8/4/4/2. The validator rejects
cycles, unknown or uncovered criteria, execution authority in Skill Goals, out-of-bound plans and
invalid Attempt transitions.

## Repository evidence

`PostgresUserGoalRuntimeRepository` proves contract/plan round-trip, plan status CAS, the one-active-
Attempt race, decimal Business Event sequences beyond JavaScript safe integers, event identity/hash
deduplication, and independent admitted/processed cursors.

## Reproducible commands

- `pnpm verify:migrations`: passed empty apply, idempotency, existing-database rejection, reset guards,
  real reset and minimum seed.
- `pnpm exec vitest run --project unit packages/domain/test/user-goal-runtime.unit.test.ts`: 4 passed.
- `pnpm exec vitest run --project integration packages/persistence-postgres/test/user-goal-runtime.integration.test.ts`:
  3 passed.
- `pnpm test:integration`: 8 files / 63 tests passed.
- `pnpm verify:infra`: passed.
