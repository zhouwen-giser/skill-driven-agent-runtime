# P10 Independent Read-only Review

Review scope: P10 candidate `9e53ebb`; frozen public and Runtime Control Skill/Plan Template
contracts; Runtime Skill and P02/P06 Artifact services; Control Operation/Audit persistence;
migrations `0140`/`0141`; focused and full verification. Every Review phase was read-only. Repairs
were performed only after the corresponding Review ended, followed by affected and full reruns.

## Blocking

None open. One Blocking was closed: a committed Skill import can now be reconciled from the existing
package-import audit when an HTTP response is lost, without importing the package twice.

## Major

None open. Five Major findings were closed:

- all four public collections implement bounded, scope-bound page tokens;
- Plan versions group by stable logical `artifact_key`, not per-version authority IDs;
- local Plan command replay is resolved before any Runtime lookup;
- real P02/P06 Artifact activation, active-pointer, Outbox and Control audit evidence replaced the
  previous mock-only Plan path;
- distinct RuntimeServiceAuth and Artifact management bearer credentials map through separate
  resolvers to the same authorized existing Artifact identity.

## Minor

One accepted Minor remains: Plan publish intentionally respects the existing default-off P06
promotion rollout flag. Deployment must set `SDAR_V13_PROMOTION_ENABLED=true` and configure a human
administrator Artifact identity. The fail-closed default is preserved and documented.

## Accepted

- `eventual` Control state is limited to ManagementOperation and Audit; Runtime PostgreSQL remains
  the only SkillVersion and Artifact authority.
- Skill publication requires validation and an Outcome Specification, uses exact-version CAS and
  never mutates the definition row.
- import and lifecycle receipts reject idempotency drift and preserve exact package identity.
- logical Plan IDs map to exact authority IDs internally; missing exact or rollback targets fail.
- Parallel public replays do not repeat Runtime calls after the Control Operation is durable.
- Redis owns no Candidate, Skill, Artifact, lifecycle or Operation fact.
- full verification and Docker/process smokes pass on the exact candidate.

Verdict: 0 Blocking, 0 Major, 1 accepted Minor; P10 is acceptable for evidence publication.
