# ADR-114: Add Monotonic v1.2.3 Migrations after the v1.2.2 Clean Baseline

## Status

Accepted on 2026-07-23. This extends ADR-109's clean-slate baseline for post-v1.2.2 releases and
supersedes ADR-106 only as a current migration-runner description; historical 0001–0107 files remain
evidence and are not replayed into a v1.2.2 database.

## Context

v1.2.2 intentionally starts new databases from one byte-stable baseline marker and rejects historical
incremental ledgers. v1.2.3 needs additive cognitive tables without editing that baseline checksum or
accepting arbitrary non-empty schemas.

## Decision

- Preserve `infra/postgres/baseline/0001_sdar_v1_2_2_baseline.sql` byte-for-byte.
- Accept exactly the ordered ledger prefix beginning with `v1.2.2_clean_slate_baseline`, followed by
  sorted `01xx_v123_*.up.sql` migrations. Unknown entries or gaps fail closed.
- G00 allocates `0108_v123_cognitive_skeleton` and provides a reverse-order down migration. The DDL
  freezes states, CAS/idempotency keys, immutable revisions, outbox/jobs and separate knowledge targets
  but activates no cognitive product service.
- Fresh empty databases receive the v1.2.2 baseline/seed and then every v1.2.3 migration. A guarded
  v1.2.2 development reset may be followed by the same additive runner.
- Unreleased v1.2.3 experimental data may be reset only in explicit development/test databases. Within a
  running v1.2.3 database, revisions and status history remain immutable.

## Consequences

The upgrade is additive and idempotent while v1.2.2 authority remains intact. Verification covers empty
apply, repeat apply, guarded reset and rogue-ledger rejection. Production data reset remains forbidden.

## Rejected Alternatives

- Edit the v1.2.2 baseline: invalidates accepted release evidence and checksum.
- Start a second cognitive database: creates another source of truth.
- Accept any marker set: makes partial/gapped upgrades indistinguishable from a valid schema.
