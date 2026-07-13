# ADR-072: Monotonic Runtime Migration Ledger

## Status

Accepted on 2026-07-13.

## Context

Legacy installations may contain schemas created before every migration wrote a `schema_migration` row. Replaying every SQL file at startup is unsafe: an older idempotent migration can still replace a later CHECK constraint with its historical narrower definition. A real startup repetition exposed this when migration 0028 removed the later `tool_enhancement` model stage even though migration 0053 was already recorded.

## Decision

Server startup creates the migration ledger if necessary, reads the highest applied four-digit migration sequence, and applies only files with a greater sequence. Fresh databases start at zero and apply the complete ordered list. Existing databases never replay an older sequence beneath a recorded newer sequence.

Migration files remain forward-only and ordered. A missing ledger entry below the recorded high-water mark is treated as legacy bookkeeping, not permission to replay historical DDL. Gaps above the high-water mark remain visible because the next ordered migration is applied normally.

## Consequences

- Repeated startup cannot regress a constraint installed by a later migration.
- Fresh bootstrap and upgraded installations share one migration runner.
- Integration setup detects a current 0053 ledger and avoids independently replaying the historical stack.
- Rollback remains an explicit operator/test operation; startup never guesses that a rollback is desired.

## Evidence

- Real PostgreSQL integration: 2 files / 36 tests passed.
- Real PostgreSQL/Redis/model/MCP end-to-end: 1 file / 40 tests passed.
- `pnpm smoke:infra`, `pnpm smoke:server`, and unified `pnpm verify` passed.
- `pnpm verify:migrations` creates isolated databases, proves a complete empty-schema migration and a historical 0049-to-0053 upgrade, checks the 0053 ledger row and current `tool_enhancement` constraint, then removes both databases.
