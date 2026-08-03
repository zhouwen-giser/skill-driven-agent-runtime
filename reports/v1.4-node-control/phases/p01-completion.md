# P01 Completion Report

## Goal

Deliver the independently startable Node Control Domain/Application/Persistence/API/Worker
foundation, dedicated PostgreSQL connection and migration ledger, Node Profile/health/Management
Operation/Audit primitives, cross-authority architecture gates and a minimum real frozen-contract
HTTP slice. Do not start P02 configuration apply/ack/LKG behavior.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `f272285eae50ef46d841a2b1267c4f7764883306`
- implementationSha: `bf564896fe373cb0d608a592eb02652a696b97b6`
- implementationRemoteSha: `bf564896fe373cb0d608a592eb02652a696b97b6`
- evidenceSha: `ef93c264c21d69b48fc71e0c459594856ce233ca`
- remoteSha: `ef93c264c21d69b48fc71e0c459594856ce233ca`, verified after the evidence push
- latestObservedMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8` from the successful P01-start fetch; a later refresh was not claimed because the approval service timed out

## Implementation

- `packages/node-control-domain`: immutable Node Profile, health/readiness, Management Operation and
  Audit types, validation and state transitions
- `packages/node-control-application`: explicit repository/clock/id ports, foundation service and
  foundation worker
- `packages/node-control-persistence-postgres`: Control-only repository and SHA-256-locked migration
  runner with gap, rogue-ledger and drift rejection
- `infra/postgres-control`: independent `sdar_control.control_schema_migration` plus reversible Profile,
  Operation and append-only Audit schema
- `apps/node-control-api` and `apps/node-control-worker`: independent environment and process
  composition; no import from Runtime persistence
- `protocol/node-control/v1`: exact validated frozen API package
- `compose.node-control.yaml`, `.env.example`, scripts and architecture checks: independent lifecycle,
  contract, integration and smoke gates

## Acceptance

| P01 criterion | Result | Evidence |
|---|---|---|
| Stop Control without stopping Runtime | passed | real Node Control smoke shuts down Control, confirms it is unavailable, then the isolated Runtime build/start/health smoke passes |
| Fresh Control database | passed | real Integration and smoke apply `0001_node_control_foundation` to disposable PostgreSQL and verify the separate ledger |
| Architecture gate | passed | 567 TypeScript sources; no cross-persistence write/import path and no Control-side LangGraph |
| API/Worker build and smoke | passed | production TypeScript build, real API discovery/auth/read projections and Worker database cycle |
| Minimum frozen HTTP slice | passed | HTTP Contract plus frozen package validator: 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures |
| P02 exclusion | passed | no configuration revision, desired/observed apply, acknowledgement or LKG implementation |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| `pnpm format:check` / `pnpm lint` / `pnpm typecheck` | passed | strict static gates; 0 skipped |
| `pnpm verify:architecture` | passed | 567 TypeScript sources |
| `pnpm verify:node-control-contract` | passed | 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures |
| `pnpm test:node-control` | passed | 3 files, 7 Unit/Contract tests |
| `pnpm test:integration` | passed | 21 files, 133 tests with real isolated PostgreSQL/pgvector and Redis |
| `pnpm build` | passed | declaration emit plus Console production bundle |
| `pnpm smoke:node-control` | passed | real Control PostgreSQL/API/Worker/process isolation and real Runtime smoke |
| `pnpm verify` | passed in 368,180 ms | 1129 Unit/Contract, 133 Integration, 72 E2E, 27 Runtime migrations, both smokes |

The successful full report is `reports/verification/summary.json` with SHA-256
`bf17181f16fa83acde32923e61dd2d3827d3da2738b4d09c7b966a90d0c46ad4`. Its `dirty=true` and
recorded commit `f272285` truthfully reflect that the required workflow runs phase gates before the
implementation commit. No test was skipped except 161 non-MUST cases explicitly outside the frozen
A2A TCK MUST scope; all 74 applicable MUST cases passed.

## Real / simulated / unverified

PostgreSQL/pgvector, Redis, migrations, repositories, HTTP, API/Worker processes, production build
and lifecycle isolation are real local evidence. Existing repository Model/MCP business fixtures in
the full E2E suite remain deterministic simulations. No external IdP, production deployment,
multi-node behavior, OIDC flow or production SLO is claimed.

## Failed attempts and repair

The first strict-lint failure, declaration-build `TS2883`, default Compose volume collision and
publication-environment failures are retained in
`reports/v1.4-node-control/failed-attempts/p01-foundation.md`. Each code/environment cause is explicit,
and the final affected gates passed without deleting existing data.

## Review and authority

The independent read-only review in `p01-review.md` closed with 0 Blocking, 0 Major and 0 Minor.
PostgreSQL remains the system of record, Redis is not a Control authority, LangGraph remains the only
workflow runtime, and neither database adapter can import or write through the other authority.

## Known limitations

P01 is a foundation slice: Management Operations are readable but no later-phase command creates
them; Runtime Control reports disabled; deployment Bearer authentication is present but later RBAC,
OIDC integration, configuration, eventing and recovery work is not claimed.

## Handoff

Status is `COMPLETED`. The implementation and evidence commits are present on the remote branch.
P02 may start after a new fetch/main comparison while preserving the P01 authority boundary.
