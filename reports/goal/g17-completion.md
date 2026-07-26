# G17 Goal Completion Report

## Summary

G17 closes release hardening with four product services over existing authorities:
`CognitiveRuntimeReconciler.rebuild`, `RetentionService.apply`,
`DeletionPropagationService.propagate` and `FeatureRolloutPolicy.evaluate`. Startup now rebuilds
terminal Outbox dispatch, all three cognitive job wakes and Active Knowledge search projections from
PostgreSQL. User deletion routes through a named propagation service. Retention remains review-only.
The frozen rollout order and low-risk/manual-review activation gate are executable policy.

The complete release gate passed from clean commit
`7e505412bc50917a71c4a724ef15f659c6d5c296` with `dirty=false`. Draft PR #9 may now become Ready for
protected review. Merge and tag remain prohibited.

## Acceptance Mapping

| Acceptance | Result | Evidence |
| --- | --- | --- |
| AC-G17-01 | verified | clean `pnpm verify` summary: all seven steps passed, production build and both smoke stages |
| AC-G17-02 | verified | reconciler/lease/outbox/attempts=1 tests, real PG/Redis integration, simulated worker/model failure and inherited real v1.2.2 DB restart |
| AC-G17-03 | verified | tenant/user scope, deletion propagation, injection/redaction and Public Card privacy tests |
| AC-G17-04 | verified | P95 2.99 ms, 20-waiter concurrency, queue bounds, model budgets and review-only retention evidence |
| AC-G17-05 | verified | executable six-stage rollout policy, conservative defaults, Replay/Shadow and advisory/active-low-risk regressions |
| AC-G17-06 | verified | 27 source pins, project license/NOTICE, 286 npm packages, two services and SBOM |
| AC-G17-07 | verified | official frozen A2A HTTP+JSON MUST 74/74 and Management OpenAPI 152/152 |
| AC-G17-08 | verified | release report states every frozen authority/advisory/Python/Skill-publication boundary |
| AC-G17-09 | verified | clean evidence published; PR open, Ready, mergeable and unmerged; no tag |

## Master Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| AC-MASTER-01 | verified | G00–G17 completed with pushed implementation/evidence |
| AC-MASTER-02 | verified | full verify, TCK, OpenAPI, migrations, architecture, sources, license and SBOM green |
| AC-MASTER-03 | verified | 62 real product E2E plus G07–G16 offline Episode→Replay evidence |
| AC-MASTER-04 | verified | complete v1.2.2 execution/Outcome/Recovery/Business Events/No Replay suites unchanged and green |
| AC-MASTER-05 | verified | evidence published; PR Ready for protected review; no merge/tag |

## Validation

| Gate | Result |
| --- | ---: |
| Unit + Contract | 765/765, 124 files |
| Real Integration | 84/84, 8 files |
| Real E2E | 62/62, 2 files |
| Cognitive Replay | passed; 1 holdout passed, 0 failed, 0 physical calls |
| Migration | 17 additive; fresh/idempotent/rollback/reapply/reset/rogue rejection |
| Architecture | 425 TypeScript sources; 20 Domain/62 Application cognitive; no Python runtime |
| A2A MUST | 74/74 |
| Management OpenAPI | 152/152 |
| Sources / protocol / licenses / SBOM | 27 pins; frozen protocol; 286 npm packages; 2 services |
| Production/smoke | Server and Console builds; pgvector/Redis and HTTP smoke passed |
| Full duration | 171,145 ms |

The clean gate used real operator-managed PostgreSQL/Redis and a disposable
`sdar_test_v123_g17_gate` database. That exact database was removed after verification. Mock Model/MCP
services exercised the real product path; they are not external-production interoperability evidence.

## Capacity and recovery

- Knowledge retrieval measured 2.99 ms P95 over 20 real PostgreSQL samples against a 500 ms target.
- Twenty concurrent notification waiters completed in 265 ms with 60 database reads, above the
  specified 1–10 active-task operating range.
- PostgreSQL remains Outbox/job/Knowledge authority; Redis wakes rebuild through the unified startup
  reconciler. Running work still fails without automatic retry; queued work remains reconstructable.
- Model failure remains fail-open for advisory enhancement and fail-closed where structured planning
  authority is required.
- Retention review can enumerate work but cannot archive/delete V1 history automatically.

## Failed Attempts

1. The first full gate stopped on three lint defects: a literal-manual redundant condition and two
   missing `node:process` imports in G16 scripts. Commit `961ac4a` fixed them.
2. The next full gate passed 61/62 E2E. Temporary Skill execution completed before asynchronous
   Evolution evidence appeared. The test now waits for the post-terminal record under its existing
   eventual-consistency contract; full E2E passes 62/62.
3. The following full gate passed all tests but smoke used stale `.env`
   `SDAR_POSTGRES_URL=...:54329` while the operator port was 55432. The failed summary was committed as
   `7e50541`; an explicitly named disposable database and explicit URL produced the final clean pass.
4. `psql` was unavailable. The already locked `pg` client created and removed only the exact temporary
   database. Operator `sdar` data was not reset or modified by this action.

No assertion was weakened, no failure was hidden and no failed test was deleted.

## Evidence boundary

- Real: PostgreSQL/pgvector, Redis/BullMQ, HTTP/A2A, Management API and Server/Console.
- Simulated: deterministic local Model/MCP behavior and explicit worker/model outage injection.
- Replay: `NoPhysicalProvider`; never a physical or formal product result.
- Unverified/not claimed: production-scale soak, physical Replay and external authentication/
  authorization beyond trusted-intranet V1.

## Frozen release declarations

```text
v1.2.3 Experience = Advisory
Candidate ≠ Active Knowledge
Capability Summary ≠ Runtime Readiness
Capability Pattern ≠ Skill
Workflow completed ≠ User Goal achieved
No Python Sidecar
No automatic Skill publication from the cognitive runtime
```

## Commits / PR

- G17 runtime controls: `8d65d3fa5cdd22fe3566e6d50f44f52e2317c66e`
- Release lint fix: `961ac4a`
- Evolution evidence timing regression: `702baab`
- retained failed verification: `7e50541`
- release evidence: `f1f354c07ea0a6f32c911115973ea60aeab26b62`
- PR #9: open, Ready for Review, mergeable and unmerged
- Merge/tag: not performed
