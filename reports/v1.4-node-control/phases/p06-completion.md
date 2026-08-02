# P06 Completion Report

## Goal

Make `NodeCapabilityDefinitionVersion` the sole Control authority for business promises and bind it
only to exact executable Skill or Plan Template versions. Enforce publish-time schema, evidence,
risk, constraint and implementation gates while preserving Runtime and Artifact authority.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `86e78550f38b86fa2615ca4358831156641f4c47`
- implementationSha: `f5be34fb3a1ef74d3564f496d93d07e3eee1bdda`
- evidenceSha: pending evidence commit and remote reconciliation

## Implementation

- Domain/Application: canonical SHA-256 definition identity, stable lifecycle ETag, exact roles
  (`primary`, `alternative`, `supporting`, `validation`, `recovery`), strict business-promise and
  JSON Schema gates, exact-version implementation lookup and publish/suspend/deprecate/retire rules.
- Binding authority: only `skill` and `plan_template` are accepted; direct Resource binding and the
  undeclared `workflow_template` category are absent. At least one active primary or alternative
  implementation is mandatory before publication.
- PostgreSQL: Control migration `0006_node_capability_authority` stores immutable definition versions,
  implementation bindings, command receipts and audit events. A database trigger rejects business
  promise mutation after publication while allowing audited lifecycle transitions.
- Cross-authority reads: the narrow read-only catalog verifies enabled/validated exact Skill versions
  and active compiled exact Plan Template artifacts in their existing authorities. Control never
  copies or writes those records.
- API: all frozen Capability write commands require `Idempotency-Key`; mutable lifecycle commands also
  require `If-Match`. GET returns the current ETag and stale commands fail with 412.

## Acceptance

| P06 criterion | Result | Evidence |
|---|---|---|
| Capability definition is sole promise authority | passed | compatibility-only Skill capability projection is deliberately mismatched in the real integration proof |
| Exact executable path before publish | passed | exact active Skill lookup plus Plan Template unit port proof; missing versions fail closed |
| Stable definition hash | passed | canonical code-point ordering and lifecycle-independent SHA-256 unit regressions |
| Promise and schema gates | passed | valid Input/Output JSON Schema compilation; Success/Evidence/Risk/Constraints validation |
| Published immutability | passed | direct SQL promise mutation rejected with SQLSTATE `55000` |
| Binding vocabulary | passed | Skill/Plan Template only; Resource rejected and no `workflow_template` added |
| Concurrency/idempotency | passed | request-hash receipts, replay after publication, ETag stale-write rejection |
| Authority isolation | passed | Control writes only Control tables; Runtime/Artifact access is read-only and exact-version scoped |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| focused Unit | passed | 2 files, 4 tests |
| focused real PostgreSQL Integration | passed | Capability 1/1; official aggregate 25 files, 138 tests |
| architecture / frozen contract | passed | 607 TypeScript sources; 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures |
| `pnpm verify` | passed in 349,754 ms | 1,150 Unit/Contract, 138 Integration, 72 E2E; 29 Runtime migrations, build and all smokes |

The accepted report is `reports/verification/summary.json` with SHA-256
`d9aeb73340e1c25997904b22b0109d9004459bfb95f324cceef59ea52ae7e1c8`.

## Real / simulated / unverified

Control and Runtime PostgreSQL, both migration ledgers, exact Runtime Skill records, exact Artifact
Plan Template records, API lifecycle, SQL immutability and command receipts are real local evidence.
No production Skill provider or production deployment was contacted. Production scale and SLOs are
unverified and not claimed. P07 runtime readiness has not started.

## Review and failed attempts

Three read-only review passes closed 3 Major and 2 Minor findings. The final verdict is 0 Blocking,
0 Major and 0 Minor. Initial lint/schema/idempotency failures and the first full-gate migration
expectation failure are retained in `failed-attempts/p06-capability-authority.md`.

## Handoff

P06 is `COMPLETED` locally. P07 may begin after evidence commit, remote reconciliation and a fresh
main comparison; it may consume published Capability definitions and exact implementation bindings
but must not replace their authority.
