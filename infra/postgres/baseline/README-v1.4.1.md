# SDAR v1.4.1 clean database materialization

The published v1.2.2 baseline and its SHA-256 sidecar remain immutable. A clean v1.4.1 Runtime
database is materialized by applying that baseline, ordered seeds, and post-baseline migrations
through `0144_v14_canonical_evidence`.

Migration 0144 performs Strategy B clean cutover: it removes the three development-only
`runtime_telemetry_export_*` tables and creates the eight canonical Evidence authorities. No old
Telemetry rows are migrated and no fabricated Evidence rows or export credentials are seeded.

For guarded development/test reset, use `pnpm db:reset:v1.4.1` with:

- `SDAR_ENV=development` or `test`;
- `SDAR_ALLOW_DESTRUCTIVE_RESET=v1.4.1`;
- a database name beginning `sdar_dev_`, `sdar_test_`, or `sdar_v141_`.

The reset rejects production environments, broad database names, replicas, and mismatched
confirmation values.
