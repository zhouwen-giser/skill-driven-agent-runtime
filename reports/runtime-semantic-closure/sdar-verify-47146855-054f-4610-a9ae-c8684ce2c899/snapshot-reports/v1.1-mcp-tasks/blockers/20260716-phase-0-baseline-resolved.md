# Phase 0 Baseline Blocker — Resolved

The first baseline repetition failed for two repository portability defects and one local infrastructure mismatch:

- SBOM evidence included platform-specific optional native leaf packages and a stale root version;
- integration bootstrap replayed old migrations when an existing ledger ended at 0053;
- the persistent PostgreSQL volume reported a libc collation-version mismatch after a host/container update.

Resolution:

- commit `d0b1402` made SBOM/license generation cross-platform and integration bootstrap monotonic through released migrations 0054–0056;
- the local databases were reindexed and collation versions refreshed without deleting data or volumes;
- clean frozen install and `pnpm verify` passed at `6f9abf88...`.

This blocker is closed and does not justify skipping any later gate.
