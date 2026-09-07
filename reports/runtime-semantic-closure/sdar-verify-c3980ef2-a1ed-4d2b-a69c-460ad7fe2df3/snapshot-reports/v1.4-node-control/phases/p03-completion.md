# P03 Completion Report

## Goal

Deliver LLM Provider Definition, capability-bearing Model Catalog, secret references, scoped Model
Route and bounded fallback governance through the P02 Revision/Apply/Ack boundary. Preserve Runtime
ownership of credentials, clients, health, route selection, invocations and running-Task stability.
Do not start P04 SMPP federation.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `6a925f2c6a3b63044724532eb719507be27f46ca`
- latestObservedMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- mainSyncSha: not required; main did not advance before P03
- implementationSha: `21c7a376b0f6d6a6b5181d2da84b75973fbbedb7`
- evidenceSha: `598024359da8509143cae26e2e46ce8f56091b6f`
- remoteSha: `598024359da8509143cae26e2e46ce8f56091b6f`, verified after push

## Implementation

- Control Domain/Application/PostgreSQL: immutable LLM Provider revisions, Model Catalog
  capabilities, safe SecretRef, health/rate policy, scoped Route, budget/timeout/attempt/fallback
  policy, capability availability checks, conflict detection and Ack-driven active projections.
- Runtime Application/PostgreSQL: Provider reconnect and Route new-task-only appliers, safe Ack
  error allowlist, encrypted existing-credential resolution, versioned Provider/Route snapshots and
  immutable Task/model-stage bindings.
- Existing Model Runtime: controlled Route resolution, exact ordered candidates, real structured and
  embedding fallback, bounded attempts/timeouts and secret-safe invocation audit categories.
- API: frozen Provider list/create/get/validate and Model Route list/create/get operations, composed
  against real Control PostgreSQL repositories.
- Migrations: Control `0003_llm_provider_model_route` and Runtime
  `0136_v14_model_control_governance`, both additive and reversible with separate ledgers.
- Real vertical integration: public Control API, P02 publish, authenticated Runtime pull/apply/Ack,
  Control Observed projection, unavailable/conflicting Route rejection, idempotent replay, fallback,
  exact old/new Task binding and durable audit across two PostgreSQL authorities.

## Acceptance

| P03 criterion | Result | Evidence |
|---|---|---|
| Secret scan | passed | zero findings across 4,151 current files and Git history |
| Route conflict/unavailable/fallback | passed | real Control API conflict/unavailable cases and Runtime fallback integration |
| Old Task version stability | passed | Route v1 Task remains pinned after v2; a new Task selects v2 |
| Runtime Ack and Observed | passed | real HTTP synchronize/Ack activates exact Provider/Route projections |
| Apply replay safety | passed | exact active Provider/Route replay succeeds; conflict/stale paths fail closed |
| Secret-safe errors and audit | passed | explicit Ack allowlist, stable transport categories and generic persisted messages |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| focused Unit | passed | 2 files, 8 tests after final sanitizer repair |
| focused real Integration | passed | P02/P03 configuration-apply file, 2 tests including complete Provider/Route path |
| `pnpm verify:v13-secrets` | passed | 4,151 files plus Git history; 0 findings |
| `pnpm verify:architecture` / frozen contract | passed | 589 TypeScript sources; 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures |
| `pnpm verify:migrations` | passed | 29 additive Runtime migrations through 0136 plus separate Control 0003 integration |
| `pnpm verify` | passed in 339,537 ms | 1,140 Unit/Contract, 135 Integration, 72 E2E; build and all three smokes green |

The successful report is `reports/verification/summary.json` with SHA-256
`685daf0f0bdd10b777607fe68c02cbab796cfa2c4b5b983721c2eab54a47dd6c`. Its recorded phase-base
commit and `dirty=true` truthfully reflect the required gate-before-implementation-commit workflow.

## Real / simulated / unverified

Both PostgreSQL authorities, migrations, Control API, Runtime HTTP client, Apply/Ack, exact revision
binding, durable invocation audit and process smokes are real local evidence. The external LLM
transport is deterministic and simulated; no physical vendor credential or paid Provider call was
made. Production deployment, external Provider health behavior, multi-node fan-out and production
SLO are unverified and not claimed.

## Failed attempts and review

All static, fixture-FK, generated-column trigger, smoke environment, performance isolation, timeout,
review and E2E cascade failures are retained in
`reports/v1.4-node-control/failed-attempts/p03-llm-governance.md`. The final independent read-only
review in `p03-review.md` closed at 0 Blocking, 0 Major and 0 Minor.

## Handoff

P03 is `COMPLETED`; implementation and evidence are present on the verified remote branch. P04 may
start only after a fresh main comparison and alone may add SMPP Registry federation.
