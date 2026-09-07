# P07 Independent Read-only Review

Review scope: P07 implementation commit `be9d01d`; frozen Capability Readiness contracts; Runtime
Application/PostgreSQL authority; Control API composition; migration; focused and full evidence.
Every review pass was read-only. Repairs followed each pass and the affected gates were rerun.

## Blocking

None.

## Major

None open. Five Major findings were closed before acceptance:

- Safety downgrade to `degraded` is immediate; stability applies only to recovery/lateral changes.
- Model readiness requires an enabled Provider referenced by an actual stage route.
- Maintenance comes from the current Node Profile instead of a hard-coded value.
- Request hashes cover Bindings, operational state, timing policy and the internal command reason.
- The frozen authenticated Runtime evaluation endpoint is composed and exercised end to end.

## Minor

None open. Two Minor findings were closed:

- Missing supporting, validation, or recovery implementations degrade an executable Capability.
- Missing readiness GET results use the frozen Problem Details envelope.

## Accepted

- Runtime is the only writer of snapshots, receipts and readiness-change Outbox facts.
- Exact dependency and operational facts participate in evaluation and auditable hashes.
- Expiry creates a safety downgrade; minimum stability prevents uncontrolled recovery flapping.
- Full evaluation input and candidate state survive restart; Redis owns no readiness authority.

Verdict: 0 Blocking, 0 Major, 0 Minor; P07 is acceptable for evidence publication.
