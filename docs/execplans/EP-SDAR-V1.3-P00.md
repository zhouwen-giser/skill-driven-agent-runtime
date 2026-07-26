# EP-SDAR-V1.3-P00 — v1.3 Foundation Gate

Status: in progress

## Purpose / Outcome

Prove from executable code, PostgreSQL migration structure, tests and reproducible runtime evidence
whether frozen `origin/main@v1.2.3-final` is a complete prerequisite for P01. The only allowed decision
is `READY_FULL` or `BLOCKED_BASELINE`. P00 changes no product code.

## Requirements Covered

- G00 and every acceptance item in the P00 `ACCEPTANCE.md`.
- Verify intact v1.2.2 execution authority and v1.2.3 Experience/Knowledge prerequisites.
- Produce frozen `BaselineGateResult` 1.1 and `V123PrerequisiteMatrix` 1.1.

## Context and Orientation

- Baseline: `856f909d22c33e6e20d7e0a1cffc2f54c03b4477`.
- Branch: `feature/v1.3-sequential-implementation`.
- Package: `docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/packages/SDAR_v1.3_P00_Codex_Goal_Package_V1.1/`.
- Existing v1.2.2 execution remains owned by `UserGoalPlanController`; v1.2.3 cognitive planning is an
  advisory decorator only.

## Frozen Inputs

- Registry version: 1.1.
- Registry SHA-256: `d7b1d971615d6e0f93583e22051a066690300c0ca9d6940f3066f7b5a7ff4cbb`.
- Contract lock: `SDAR-V1.3-P00`, schema version 1.1.
- No upstream package or consumed contract.

## Contract Versions

- `BaselineGateResult` 1.1 /
  `5aacbf026e86abc963544573d7cd45db971ecb160b9f310e063f8b73961e4135`.
- `V123PrerequisiteMatrix` 1.1 /
  `04281d02bccf1e1ce84f80091d3c4a1d2e75d1bb59705d8b8af7634b2d4de95c`.
- `HandoffEnvelope` 1.1 /
  `d8b539823cd27e96ba4a1c15925818267a8fc4af9aa4699cad597e009a1580b5`.

## Architecture and Interfaces

No runtime interface is added. The audit must prove that LangGraph.js remains the only Workflow
runtime, PostgreSQL remains the sole authority, Candidate Knowledge never enters formal planning,
Replay/Shadow has zero physical side effects, and confirmed plans enter the existing v1.2.2 authority.

## Progress

- [x] 2026-07-26 Located and validated all package assets and the shared registry.
- [x] 2026-07-26 Verified `origin/main == v1.2.3-final` and created the integration branch.
- [x] 2026-07-26 Installed the frozen dependency graph.
- [x] 2026-07-26 Passed a complete dirty-tree diagnostic `pnpm verify` after isolating a dedicated
  clean-slate database; a clean-commit rerun remains required for completion evidence.
- [ ] Run and retain the clean-commit full verification result.
- [ ] Inspect prerequisite implementation, migration and release evidence item by item.
- [ ] Generate actual contracts, completion report and standard Handoff.
- [ ] Complete independent read-only review and close blocking/major findings.
- [ ] Commit P00 evidence and orchestration state.

## Changed Files

Only `docs/`, `reports/`, task-package assets and verification evidence may change.

## Migrations

P00 creates no migration. It verifies the existing monotonic migration head and rollback checks.

## Implementation Steps

1. Run `pnpm verify` from the frozen dependency environment.
2. Run/inspect architecture, migration, OpenAPI, A2A and Experience prerequisite evidence.
3. Map every P00 prerequisite to executable source, real test and generated report evidence.
4. Generate exact frozen output contracts and Handoff.
5. Obtain a fresh independent read-only review and remediate evidence defects.

## Tests / Validation

- `pnpm verify`
- `pnpm verify:architecture`
- `pnpm verify:migrations`
- `pnpm verify:management-openapi`
- `pnpm verify:a2a-baseline`
- `pnpm verify:cognitive-replay`
- P00 `scripts/self-check.mjs`

Results must distinguish real PostgreSQL/Redis execution, deterministic Model/Provider simulation and
unverified production behavior.

## Failed Attempts

- 2026-07-26 first `pnpm verify` stopped at root lint with 18 errors. The frozen task-package
  `self-check.mjs` files rely on Node globals and the aggregate validator contains an unused imported
  `crypto`; adding the supplied task assets made `eslint .` scan them as product source. The package
  files and their SHA-256 manifests must remain unchanged, so the root ESLint input set now excludes
  the frozen `docs/SDAR_v1.3_Codex_Goal_Packages_Aligned_V1.1/**` asset tree. Full verification must be
  rerun from the beginning.
- 2026-07-26 second `pnpm verify` passed 765 unit/contract, 84 real integration and 62 real E2E tests,
  plus all static, protocol, migration, Replay and build gates, but `smoke:infra` found the operator's
  default `sdar` database is a protected pre-clean-slate incremental database and correctly reported
  `INFRA_SMOKE_MIGRATION_MISSING`. The database was inspected read-only and was not reset.
- The first attempt to query/create a dedicated database embedded a PostgreSQL `$1` placeholder in a
  double-quoted shell command; shell expansion removed it and PostgreSQL returned syntax error before
  any database was created. The retry used a fixed audited database name.
- A new, separately named `sdar_v13_orchestration_verify` database received the v1.2.2 clean baseline
  and all 17 additive migrations. Focused infrastructure smoke and the third complete `pnpm verify`
  then passed. This was a dirty-tree diagnostic; the same gate will be rerun on the baseline commit.

## Review Findings

Independent review pending.

## Idempotence and Recovery

All P00 checks are read-only or regenerate evidence deterministically. Resume by validating
`reports/v1.3-orchestration/state.json`, the current HEAD and the registry hash before rerunning checks.

## Evidence

Startup evidence is recorded in `reports/v1.3-orchestration/execution-log.md`. Package-local evidence
paths will be added after verification.

## Decisions

- Use the exact `origin/main` commit carrying tag `v1.2.3-final`.
- Preserve P00 as a documentation/evidence-only gate.

## Completion / Handoff

Pending verification and independent review.

## Outcomes and Retrospective

Pending.
