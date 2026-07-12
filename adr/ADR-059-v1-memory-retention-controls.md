# ADR-059: Persist retention controls without automatic cleanup in V1

## Status

Accepted — 2026-07-12

## Context

FR-MEM-006 requires V1 to retain historical data automatically while reserving archive, deletion and retention-policy configuration in both the model and management API.

## Decision

- Add a PostgreSQL-authoritative singleton `MemoryRetentionPolicy` with review, archive and delete day fields, explicit automatic archive/delete flags, and update time.
- Default to review at 90 days, archive review at 365 days and delete review at 730 days. These values are planning metadata only.
- Domain validation requires positive periods and deletion later than archive when both exist.
- V1 rejects either automatic flag set to true with `MEMORY_AUTOMATIC_CLEANUP_FORBIDDEN`. PostgreSQL CHECK constraints independently enforce the same invariant.
- Expose GET/PUT management routes. Do not add a scheduler, archive worker, delete query or physical cleanup implementation.
- Retain direct reads, status history and all Memory rows regardless of policy changes.

## Consequences

Operators can prepare and inspect future retention thresholds without risking silent data loss in V1. Actual archive/delete execution requires a later ADR, migration, explicit workflow and acceptance evidence.
