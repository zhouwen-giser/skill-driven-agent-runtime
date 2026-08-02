# P10 Completion Report

## Goal

Expose frozen Skill and Plan Template governance through Node Control while delegating every
content and lifecycle mutation to the existing Runtime SkillVersion and P02/P06 Artifact
authorities.

## Source and commits

- baselineMainSha: `a7a7c62cd39fb7d4ee7c67b18929c557593b08b8`
- phaseBaseSha: `6f1828cab39ca7425d08662ae1ad5a96ea5c336a`
- primaryImplementationSha: `0c0e2c6`
- implementationSha: `9e53ebb0e604558195b51a9cdd5e34d122c89848`
- evidenceSha: `PENDING_EVIDENCE_COMMIT`

## Implementation

- Added frozen public Node Control Skill list/import/exact-version/publish/suspend/deprecate and
  Plan Template list/exact-version/publish/revalidate/suspend routes with authenticated paging.
- Added authenticated Runtime Control command routes and an HTTP adapter. Skill reads reuse the
  existing Runtime registry; Plan reads and commands reuse the existing Artifact management query
  and command services.
- Added Runtime-owned exact Skill lifecycle overlay, optimistic revision checks, immutable command
  receipts and durable package-import recovery in migrations `0140` and `0141`. The immutable base
  SkillVersion definition remains the content authority.
- Plan Template public IDs are logical `artifact_key` identities. The internal exact
  `compiled_artifact.artifact_id` is resolved only inside the adapter and never exposed publicly.
- Node Control persists only the proxy `ManagementOperation` and append-only audit. It contains no
  Skill or Artifact content table and writes no Runtime business table.
- RuntimeServiceAuth can use a distinct secret from Artifact management authentication; a dedicated
  principal resolver maps the internal credential to the configured existing Artifact identity.
- Fixed existing Artifact query redaction so PostgreSQL timestamps remain ISO strings instead of
  becoming empty objects.

## Acceptance

| P10 criterion | Result | Evidence |
|---|---|---|
| No second Skill/Artifact registry | passed | Control SQL inspection, architecture gate, real dual-database assertions |
| Exact-version Skill governance | passed | CAS/replay/immutable-content PostgreSQL integration and frozen HTTP contract |
| Validate/import recovery | passed | real Skill package validation/import, durable command reconciliation after response loss |
| Plan query/publish/revalidate/suspend adapter | passed | real P02/P06 Artifact activation, exact logical-to-authority mapping and contract coverage |
| Idempotent/CAS/audited | passed | Runtime receipts, Control Operation/Audit, replay-before-network and drift rejection tests |
| Existing Runtime behavior | passed | full Unit/Contract/Integration/E2E, architecture, build and process smokes |

## Validation

| Command | Result | Counts / classification |
|---|---|---|
| focused Unit | passed | 3 files, 17 tests |
| focused Contract | passed | 2 files, 63 tests |
| focused real PostgreSQL Integration | passed | 2 files, 5 tests, including 2 end-to-end governance paths |
| migration verification | passed | 34 additive Runtime migrations through `0141`; Control remains 7 migrations |
| frozen contract / architecture / build | passed | 76 files, 28 schemas, 111 operations, 20 events, 7 fixtures; 164 management operations; 629 TypeScript sources |
| `pnpm verify` | passed in 391,314 ms | 930 Unit + 22 performance, 218 Contract, 143 Integration, 72 E2E; build and all smokes |

The accepted report is `reports/verification/summary.json` with SHA-256
`a17d590a3f69c29f300b9d4729e86ec2ffba579c2f92411c536b60666506d9c6`.
The verifier truthfully reports `dirty=true` because gate-owned verification reports from the
retained failed runs existed before the successful run; product code at the verified candidate was
the exact committed SHA above.

## Real / simulated / unverified

PostgreSQL migrations, Skill package import, CAS/idempotency, Control-to-Runtime HTTP, P02/P06 Plan
activation, active pointer, Outbox, Control Operation/Audit and Docker/process smokes are real local
evidence. Skill and Plan content are deterministic repository fixtures; no physical external
Provider operation was invoked. Multi-node contention is outside the single-node Goal and is not
claimed.

## Review and failed attempts

The independent read-only review rounds closed 1 Blocking and 5 Major findings. Final verdict is
0 Blocking, 0 Major and 1 accepted Minor (the existing P06 promotion rollout flag remains an
explicit deployment prerequisite). Failed attempts are retained in
`failed-attempts/p10-skill-plan-governance.md`.

## Handoff

P10 is `COMPLETED` locally. P11 may implement telemetry export only. It must not introduce a second
telemetry query authority or move Skill/Artifact/Operation authority into Redis.
