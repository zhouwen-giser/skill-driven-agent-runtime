# SDAR Telemetry joint-debug verification — 2026-08-26

## Verdict and scope

Implementation and focused component verification are complete. **Live activation/whole-stack
acceptance is not complete**: no real Commander/NPC producer configuration has been supplied or
installed in the new dedicated Control PostgreSQL. The old debug stack was not restarted.
`SDAR → Commander/NPC` is explicitly deferred by the user and remains empty, not replaced by fixtures.

No A2A Task, confirmation, navigation or other Device tool call was made. No historical data,
debug configuration, acceptance report, production configuration or task-owned volume was deleted.
No code was committed or pushed by this implementation turn.

## SDAR commands

Executed from the SDAR repository:

```bash
pnpm exec vitest run \
  apps/node-control-acceptance/test/ugv-debug-command.contract.test.ts \
  apps/node-control-acceptance/test/ugv-debug-profile.unit.test.ts \
  apps/node-control-acceptance/test/ugv-debug-sdar-telemetry.unit.test.ts \
  apps/server/test/runtime-migration-selection.contract.test.ts \
  packages/node-control-domain/test/evidence-export.unit.test.ts \
  packages/runtime-control-application/test/evidence-export-service.unit.test.ts \
  packages/evidence-export-adapter/test/http-evidence-export-transport.contract.test.ts
pnpm exec vitest run apps/node-control-api/test/http-endpoint.contract.test.ts \
  packages/management-api/test/http-endpoint.contract.test.ts
SDAR_TEST_POSTGRES_URL=<isolated-test-db> pnpm exec vitest run \
  packages/runtime-control-persistence-postgres/test/evidence-export.integration.test.ts
pnpm typecheck
pnpm build
pnpm verify:architecture
pnpm verify:evidence-contract
```

Results: **7 files/62 tests**, **2 files/87 tests**, **1 file/8 real-PG tests** pass, no skips.
Typecheck and production build pass; architecture checks 858 TS sources; Evidence frozen contract
remains 100 records, 95 required/5 diagnostic and the same registry hash. Changed-scope ESLint,
Prettier, shell/Node syntax and diff whitespace checks pass. The tsx contract command required the
host context because the sandbox denied its local IPC pipe; the host rerun passed.

The isolated PostgreSQL container is `sdar-telemetry-debug-test-pg`, port 55474, task label
`io.sdar.owner=telemetry-debug-tests`, tmpfs only. It does not use live ports 55462/55463. Repeated
migration testing found the initial missing `schema_migration` insert in migration 0174; this was
fixed before any debug Runtime migration. A fresh isolated database then passed first start,
second start, down/up, incremental-down refusal and the original ACK/fencing tests. No manual
version stamping, table deletion or repair was applied to the live Runtime.
After the final tests, the exact labeled container and its disposable tmpfs test databases were
removed; no debug/production volume was involved. Test data is disposable and is not retained.

## SDAR Telemetry commands

Executed in `../sdar-telemetry-platform` without loading the real `.env` during tests:

```bash
npm run typecheck
npm run build
SDAR_TEST_CONTROL_POSTGRES_URL=<isolated-test-db> \
  node --test dist/tests/unit/*.test.js dist/tests/integration/*.test.js
python3 scripts/static_verify.py
npm run check:sdar-clickhouse-contract
npm run check:domain-source-contracts
```

**183/183 tests pass**, no skips. Typecheck/build/static checks pass. Frozen CH contract check:
472 objects, 15,949 columns, 31 required objects and zero descriptor drift. Domain source check:
4 schemas, 10 source IDs, 16 frozen fixtures unchanged. Formatting checks cover changed files.

The new runtime integration tests use **real isolated PostgreSQL and an explicit test ClickHouse
adapter**. They prove actual consumer execution of all ten mappers, formal four-stage activation,
ACTIVE-empty vs unregistered vs contract drift vs target-write failure, source scope, persistent
origin, lease fencing, target/lineage writes and restart dedupe. They are not external warehouse
business-data or full Docker lifecycle evidence. Unsupported queued management targets/version
are rejected without poisoning the next action. Unknown lag/seal/DLQ metrics are omitted, not 0.

## SMPP Telemetry commands

Executed in `../smpp-telemetry-platform`:

```bash
npm run build
node --test dist/telemetry-processor/test/*.test.js \
  dist/telemetry-collector/tests/*.test.js \
  dist/telemetry-dashboard/query-api/test/*.test.js \
  dist/telemetry-schema/tools/*.test.js
npm run typecheck
```

Build and **70/70 tests** pass. Whole-repository strict typecheck remains blocked by the same
**450 pre-existing diagnostics**, with none in the new test. This repository's existing build uses
`--noCheck`; its build pass is not a strict typecheck pass. No assertions or compiler settings were
weakened. The new test exercises SourceMappings v4, WAL, both formal target workers/schema preflight,
old-route exclusion, new-record dual delivery, independent checkpoints and reopen without replay.
Tests retain local seven-day diagnostic TTL assertions; no new retention policy is introduced.

## Real, non-business smoke

- Read-only metadata initially found no `sdar_core.sdar_evidence_v1_record` in the current external
  warehouse, despite older historical reports. Ran the existing reviewed migration with
  `ALLOW_CLICKHOUSE_ADDITIVE_MIGRATION=sdar.evidence/v1 node --env-file-if-exists=.env
  dist/scripts/apply-evidence-v1-migration.js`. Its DDL SHA-256 is
  `fb0b073f7c590ca56285da91a7253e7426db84dd19b587a2baa01635a4542ff9`; only the fixed two
  CREATE-IF-NOT-EXISTS statements are permitted. Result: applied-and-verified ReplacingMergeTree.
- `node --env-file-if-exists=.env dist/scripts/preflight-ugv-debug.js` returned
  `{status:passed, readonly:true, domainMappings:10, evidenceColumns:58}`. Actual release is
  `1.5.1-rc.2`, migration range `00..26`, with both expected schema/release hashes.
- A temporary loopback Query HTTP server using the real read-only warehouse client and existing
  SMPP Query upstream returned HTTP 200 with one stored row for gauge, sum and Trace, and HTTP 200
  for that actual TraceId. Only counts/provenance were printed; no raw business payload or secret.
- Existing ProviderOps query initially rejected a mistakenly supplied `limit` parameter (400);
  using its unchanged allowed `smppSourceId` filter returned HTTP 200, **zero rows** for this debug
  source. This is not evidence of new ProviderOps delivery. No empty result was filled with samples.
- `docker compose ... config --format json` confirms all new ports bind 0.0.0.0, no PG host port,
  default domain enabled/active, fixed shared-network Query DNS and exact read-only review mount.
  No Grafana service or port 3000. The sandbox denied docker subprocess inspection; host rerun passed.

## Remaining acceptance and recovery

Real source registration must come from actual Commander/NPC owners in the configured scope.
Without it, formal bootstrap reports `DOMAIN_SOURCE_PRODUCER_NOT_REGISTERED`; it must not fabricate
registration or ACTIVE. Once supplied, run the normal launcher and observe actual incremental
Evidence/ProviderOps/domain data, lineage and restart recovery. Existing debug services are left as
they were; none of the new services is claimed running by this report.

Control migration 004 preserves lifecycle, first ingestion boundary and completion identities; no
automatic destructive down is provided. Runtime 0174 refuses down if any incremental origin exists.
External migration 014 has no automatic DROP rollback. Stop/restart retain data and credentials.
The implementation gate does not mark the full ExecPlan or project complete while these live
requirements and the pre-existing SMPP strict-typecheck baseline remain unresolved.
