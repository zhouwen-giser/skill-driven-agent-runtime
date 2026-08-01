# P00 Completion Report

## Goal

Resolve the exact latest `main`, prove that it is green and v1.3-ready, validate the frozen v1.4
inputs, create the v1.4 branch, and establish auditable source/authority maps without production
feature changes.

## Baseline

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- latestObservedMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- mainSyncSha: not required; the branch was created directly from latest main

## Implementation

- implementationSha: `c8ec91505ea600fe5c5cebb07394d2366628ada9`
- evidenceSha: `c5ffbda99f58f8b907727eb6287ba8a4efd86e5e`
- remoteSha: `c5ffbda99f58f8b907727eb6287ba8a4efd86e5e` verified after evidence push
- changedFiles: authorized task package, ExecPlan, baseline/source/maps, project status, changelog and
  traceability only; no product source, migration or runtime configuration changed

## Frozen Contracts

- designFreezeSha: `1d0c72a9a54baf88ddd0a2d8a585b33e0c1ba056694c16b37cf19e6b18dfb4cb`
- backendApiFreezeSha: `367797107847c210bb4240d5525ad0cfa625f8f65856f1eddc7c61bff2523d1c`
- contractChanges: none
- ADRs: task-package `ADR-V14-GOAL-001` accepted as scoped guidance; no repository product ADR needed
  in P00

## Validation

| Command | Started | Finished | Exit | Passed | Failed | Skipped |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| `pnpm install --frozen-lockfile` | 2026-08-01T16:49Z | 2026-08-01T16:49Z | 0 | lockfile install | 0 | 0 |
| first sandboxed `pnpm verify` | 2026-08-01T16:50Z | 2026-08-01T16:53Z | 1 | 1122 unit/contract and bootstrap | Docker migration stage | later stages not run |
| privileged `pnpm verify` on existing Compose name | 2026-08-01T16:53Z | 2026-08-01T16:55Z | 1 | bootstrap and migrations | PostgreSQL `XX000` collation | later stages not run |
| isolated full `pnpm verify` | 2026-08-01T16:55:40Z | 2026-08-01T17:01:25Z | 0 | 1122 unit/contract, 130 integration, 72 E2E | 0 | A2A baseline reports 161 non-MUST cases outside its frozen MUST scope |
| task package validator | 2026-08-01T17:03Z | 2026-08-01T17:03Z | 0 | package, 15 phases, 2 inputs | 0 | 0 |
| design/API freeze validators | 2026-08-01T17:03Z | 2026-08-01T17:03Z | 0 | 2 packages, 28 schemas, 111 operations, 20 events, 7 fixtures | 0 | 0 |
| `pnpm format:check` | 2026-08-01T17:05Z | 2026-08-01T17:05Z | 0 | formatted source set | 0 | 0 |
| `pnpm verify:architecture` | 2026-08-01T17:05Z | 2026-08-01T17:05Z | 0 | 544 TypeScript sources | 0 | 0 |

## Real / Simulated Classification

The successful full gate used real local Docker PostgreSQL/pgvector and Redis, real migrations,
repository integration/E2E suites, production builds and process smoke. Existing model/MCP fixtures
retain their repository-defined simulation classifications. This is local acceptance evidence, not a
production SLO or deployment result.

## Failed Attempts and Root Causes

All three first attempts and their repairs are retained in
`reports/v1.4-node-control/failed-attempts/p00-baseline.md`. Existing Docker data was preserved.

## Architecture and Authority Check

The baseline retains PostgreSQL and LangGraph authorities. P00 creates no second workflow, Task,
Skill, Artifact, Provider, readiness, Agent Card or telemetry authority. The planned Control/Runtime
database and API boundaries match the frozen authority matrix.

## Security and Secrets

No secret values were read or recorded. Baseline evidence contains hashes, tool versions, public
repository settings and synthetic/local test classifications only.

## Known Limitations

GitHub reports no main branch protection. The task policy still requires no bypass, explicit checks
and Merge Commit handling in P14. The isolated Compose volumes remain stopped for reproducibility and
contain only test data.

## Handoff

- status: `COMPLETED`
- nextPhase: P01
- prerequisites: fetch `origin/main`; if unchanged, implement only the independent foundation bounded
  by P01
