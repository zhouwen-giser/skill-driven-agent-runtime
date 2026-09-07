# P00 Migration map

The existing Runtime migration ledger is preserved unchanged at
`0134_v13_artifact_management_projection` (27 additive up migrations, 197 files including down and
support files). Its deterministic filename/SHA-256 ledger digest is
`a1bcb1165f96e2d050e4034da9900b0eb244996e3033e788386f99a6d3c65a9f`.

v1.4 creates a separate Control PostgreSQL database named `sdar_control`, with a separate connection,
credential and migration ledger. P01 establishes its fresh baseline; later phases add bounded
objects in phase order. The control ledger must prove fresh create, idempotent gate, ordered upgrade,
rollback/reapply, gap/rogue-ledger rejection and constraints/indexes. It never deletes or rewrites the
Runtime ledger and provides no compatibility path for experimental Control databases.

Runtime-owned v1.4 tables, such as readiness, Agent Card revision and immutable Task capability
binding/attempt, use additive Runtime migrations in their owning phases and retain the existing
ledger's monotonic checksum rules.
