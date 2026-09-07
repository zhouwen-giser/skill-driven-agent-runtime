# SDAR v1.2.1 Phase 3 Persistence Authority

Status: **PASSED WITH BASELINE HOST LIMITATION**

Migration 0107 adds append-only Provider protocol snapshots, explicit Server protocol authority,
output schemas, immutable Workflow protocol contracts and Frozen binding/observation/control revision
columns. Historical records backfill to `legacy_v11`; Frozen runtime revisions use canonical decimal
checks and partial unique indexes. Rollback fails closed while Frozen Server or binding authority exists.

PostgreSQL repositories round-trip Frozen discovery snapshots, Tool output/task profiles and Workflow
contracts without translating them to V1.1 fields. The released migration chain applies 0107; the
explicit `v1.1-isolated` chain remains capped at 0106.

## Verification

| Command | Result |
| --- | --- |
| `TEST_DATABASE_URL=... pnpm verify:frozen-migrations` | passed empty, 0106 upgrade, idempotent, rollback/reapply, Legacy backfill, unsafe rollback and ledger-gap guards |
| focused PostgreSQL Repository integration | passed 58/58 on isolated port 55433 |
| `pnpm test:unit` | passed 75 files, 471 tests |
| `pnpm test:contract` | 112/113 passed; unchanged Windows symlink setup failed with `EPERM` |
| `pnpm verify:architecture` | passed across 260 TypeScript source files |
| `pnpm build` | passed |
| `pnpm verify:infra` | passed 71 migration pairs and Compose configuration |
| format/lint/typecheck | passed after final formatting/lint correction |

The disposable PostgreSQL container was deleted. The operator-owned service on port 55432 was not
modified. Phase 3 proves persistence authority, not Frozen HTTP or lifecycle behavior.
