# Isolated PostgreSQL Restart Audit

Status: **passed** on 2026-07-22.

An independent disposable container used the exact Compose pgvector image digest
`sha256:69573b32242ca232f65871d4cb916ba7210a372b9bd74068204c1a9a57bada4f` and a dedicated Docker volume.
The audit:

1. created database `sdar_v122_restart`;
2. applied `0001_sdar_v1_2_2_baseline.sql` and the minimum seed with `ON_ERROR_STOP`;
3. verified migration `v1.2.2_clean_slate_baseline` and wrote `evolution_policy.success_threshold=9`;
4. restarted the PostgreSQL container;
5. verified the migration marker, value `9` and pgvector `0.8.5` after restart.

The dedicated container and volume were then stopped and deleted. The repository's operator-managed
PostgreSQL/Redis services were not restarted or modified by this audit.

Classification: real local PostgreSQL/pgvector process restart and durable-volume persistence.

