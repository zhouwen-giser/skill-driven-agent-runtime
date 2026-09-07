# P04 Completion Report

## Goal

Deliver bounded multi-source SMPP Registry federation as a Provider candidate directory with stable
identity, immutable Snapshot lineage, conditional Latest refresh, atomic activation and local LKG.
Preserve live Discover/Tools Catalog, Availability and Runtime Task authorities. Do not start P05 MCP
Provider binding governance.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `d544691cb40325e695525f81184eef8be1e7db16`
- latestObservedMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- mainSyncSha: not required; main did not advance before P04
- implementationSha: `11d13d08d3d72d76cabb4b85fce8cac0967478d3`
- evidenceSha: `7c9b733223f0b8b69098a4e55ae330203d37ee03`
- remoteSha: `7c9b733223f0b8b69098a4e55ae330203d37ee03`, verified after push

## Implementation

- Domain/Application: strict SMPP Source/Snapshot/candidate models, stable Source + external Provider
  + external Server identity, deterministic checksum, bounded TTL, ETag, Registry/Catalog lineage,
  idempotent create/sync and explicit safe error categories.
- PostgreSQL: Control migration `0004_smpp_registry_federation` adds immutable Sources, Snapshots,
  candidates and sync attempts, one active Source revision, atomic pointer changes, rollback/drift
  rejection and LKG query policy.
- External adapter: authenticated conditional HTTP Latest fetch resolves only `secret://env/*`,
  validates strict payloads and never returns response bodies or credentials in failures.
- API/Worker: frozen Source list/create/get/sync and candidate-list operations plus scheduled
  poll/watch refresh. Worker invokes real authoritative refresh and reports attempted/failed counts;
  Redis owns no Registry facts.
- Real vertical integration: public Node Control API, external HTTP Registry fixture, Control
  PostgreSQL and a real Runtime PostgreSQL executing Task prove multi-source isolation, Source
  revision activation, 304 replay, rollback/drift/checksum rejection, policy-specific outage and
  Runtime stability.

## Acceptance

| P04 criterion | Result | Evidence |
|---|---|---|
| Same external IDs across Sources | passed | two candidates have distinct stable composite identities |
| Registry/Catalog lineage | passed | projection carries Registry revision/checksum/ETag/valid-until plus Catalog revision |
| Bad Snapshot preserves LKG | passed | rollback, same-revision drift and bad checksum cannot replace active candidate |
| Outage policy | passed | allow-unexpired keeps candidate; deny-when-unavailable returns none |
| Running Task isolation | passed | Runtime Task remains `executing` through both Source outages |
| Revision/Checksum/ETag | passed | deterministic checksum, monotonic Source revision, atomic active pointer and 304 tests |
| Authority boundary | passed | Registry has no Tool Schema, Task Profile or live Availability truth |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| `pnpm test:node-control` | passed | 8 files, 20 focused tests |
| `pnpm test:integration` | passed | 23 files, 136 real PostgreSQL/Redis tests |
| `pnpm verify:v13-secrets` | passed | 4,188 files plus Git history; 0 findings |
| architecture / frozen contract | passed | 596 TypeScript sources; 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures |
| `pnpm verify` | passed in 354,538 ms | 1,143 Unit/Contract, 136 Integration, 72 E2E; 29 Runtime migrations, build and all smokes |

The successful report is `reports/verification/summary.json` with SHA-256
`29f6a9ef30060d3f700b38c5ba15435e06697f2d3ef7040b91df43fc54585ef8`. Its recorded pre-commit
SHA and `dirty=true` truthfully reflect the required gate-before-implementation-commit workflow.

## Real / simulated / unverified

Control and Runtime PostgreSQL, both migration ledgers, Node Control API, HTTP adapter, Worker cycle,
LKG queries and executing Runtime Task are real local evidence. The external SMPP Registry endpoint
is a deterministic local HTTP fixture that exercises credentials, ETag and payload validation; no
production Registry was contacted. Production network behavior, external Registry scale and
production SLO are unverified and not claimed. P05 approval/import, Discover/Tools Catalog and live
Availability are intentionally not implemented by P04.

## Failed attempts and review

All static, database selection, fixture cleanup, Source-version, lineage-review and Docker
permission failures are retained in `failed-attempts/p04-smpp-registry.md`. The repeated independent
read-only review in `p04-review.md` closed at 0 Blocking, 0 Major and 0 Minor after the first pass's
single lineage Major was repaired and retested.

## Handoff

P04 is `COMPLETED`; implementation and evidence are present on the verified remote branch. P05 may
start only after a fresh main comparison and alone may add approved MCP Provider binding/import,
real Discover/Tools Catalog validation and binding lifecycle governance.
