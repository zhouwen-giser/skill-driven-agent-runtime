# P02 Completion Report

## Goal

Deliver immutable Configuration Revision/Application and Desired/Observed control authority, the
Runtime Bootstrap/Latest/Watch/Apply/Ack boundary, durable Runtime Active/LKG/Ack/Task-pin state and
the required concurrency and outage semantics. Do not start P03 provider governance.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `574e8e1f56afd021fbf5be52c7bd7913289f52cb`
- implementationSha: `deaa555f865861886a480d8ca1c744a4b6becfd4`
- evidenceSha: `9a283eb82a8499045a493618295dc2872fcf8d0e`
- remoteSha: `9a283eb82a8499045a493618295dc2872fcf8d0e`, verified after the evidence push
- latestObservedMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`

## Implementation

- Control Domain/Application/PostgreSQL: immutable canonical revisions, validation/publish/rollback,
  Desired/Observed convergence, application acknowledgements, operation lifecycle, idempotency,
  ETag/If-Match and target-scoped CAS.
- Runtime Application/PostgreSQL/HTTP: Latest/Bootstrap/Watch/Ack client, apply policy, durable
  Active/LKG, Ack outbox and immutable running-Task revision binding.
- Public and internal API: frozen Configuration routes plus authenticated `/internal/v1/bootstrap`,
  `/internal/v1/revisions/latest`, `/internal/v1/revisions/watch` and `/internal/v1/acks`.
- Migrations: Control `0002_configuration_revision_apply_lkg` and Runtime
  `0135_v14_runtime_configuration_lkg`, both additive and reversible with separate ledgers.
- Real vertical integration: public create/validate/publish through Control API, Runtime HTTP pull,
  apply and Ack across two PostgreSQL authorities, operation closure, LKG outage recovery, bad and
  partial revision rejection, task pin stability, rollback and SSE hints.

## Acceptance

| P02 criterion | Result | Evidence |
|---|---|---|
| Publish is not Applied | passed | publish sets Desired/pending and Operation running; only Runtime Ack produces Observed/applied |
| Control outage uses Runtime LKG | passed | real integration stops the Control endpoint and restarts synchronization from Runtime PostgreSQL LKG |
| failed Revision does not overwrite Active/LKG | passed | partial and forged-checksum paths retain the prior Active/LKG and persist failure Ack |
| concurrent publish has one winner | passed | two real concurrent If-Match publish commands produce one success and one conflict |
| running Task does not auto-switch | passed | immutable Runtime task binding remains on revision 1 after revision 2 is active |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| focused Unit/Contract | passed | 13 tests |
| `pnpm test:integration` | passed | 22 files, 134 tests on isolated real PostgreSQL/pgvector and Redis |
| `pnpm verify:architecture` / frozen contract | passed | 581 TypeScript sources; 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures |
| `pnpm verify:migrations` | passed | 28 additive Runtime migrations through 0135 plus separate Control 0002 integration |
| `pnpm build` and smokes | passed | production build, infrastructure, Server and Node Control process smokes |
| `pnpm verify` | passed in 373,986 ms | 1135 Unit/Contract, 134 Integration, 72 E2E; all required stages green |

The successful report is `reports/verification/summary.json` with SHA-256
`ac3f69903b4460b3a30eb38d343c638128777a4a141b253777436dd6e45025ba`. Its recorded pre-commit SHA
and `dirty=true` truthfully reflect the required gate-before-implementation-commit workflow.

## Real / simulated / unverified

The Configuration API, both PostgreSQL authorities, migrations, HTTP client, SSE hint, Runtime
agent, durable Ack, task pinning, outage and process smokes are real local evidence. Pre-existing
Model/MCP E2E fixtures remain deterministic simulations. External IdP, multi-node fan-out,
production deployment and production SLO are unverified and not claimed.

## Failed attempts and review

All initial static, Docker, collation, migration-loader, environment inheritance and smoke-readiness
failures are retained in `reports/v1.4-node-control/failed-attempts/p02-configuration-control.md`.
The independent read-only review in `p02-review.md` closed at 0 Blocking, 0 Major and 0 Minor.

## Handoff

P02 is `COMPLETED`; implementation and evidence are present on the verified remote branch. P03 may
start after a fresh main comparison and alone may add LLM Provider and Model Route governance.
