# MCP Tasks Runtime Consumer Sync — Test Report

Date: 2026-08-31

Status: **PASS**

## Final repository gate

Command:

```text
SDAR_REUSE_EXISTING_INFRA=false \
SDAR_POSTGRES_PORT=55464 \
SDAR_REDIS_PORT=56392 \
SDAR_TEST_POSTGRES_URL=postgresql://sdar:<redacted>@127.0.0.1:55464/sdar \
pnpm verify
```

Result: exit 0 in 1,472,233 ms. The generated authority is
`reports/verification/summary.json`.

- Bootstrap/static/unit/contract/build: 326 files, 2,838 tests, 169 OpenAPI operations.
- Runtime migration path: 68 migrations through `0175_v14_mcp_task_consumer_sync`.
- PostgreSQL/Redis integration: 40 files, 228 tests.
- PostgreSQL/Redis/model/MCP E2E: seven files, 73 tests.
- Official A2A TCK: PASS (74 applicable tests passed; non-applicable tests skipped by the TCK).
- Canonical Evidence Phase 12: 44/44 scenarios, 42 direct tests in 25 shared suites.
- Phase 13: Runtime P95 regression 1.1545% (limit 10%), baseline median drift 14.5851%
  (limit 15%), Evidence append P95 9.2681 ms (limit 20 ms).
- Infrastructure, Server/Console, and Node Control API/Worker smoke gates: PASS.

The Node Control smoke intentionally stops a PostgreSQL child while checking Runtime-after-Control-stop;
its child process logs SQLSTATE `57P01`, while the smoke and enclosing verification both exit 0.

## Formal Evidence contract

- `pnpm verify:evidence-contract`: PASS, 105 records; 100 Required and five Diagnostic.
- `pnpm verify:evidence-coverage`: PASS, 105/105 implemented and verified.
- Registry SHA-256:
  `7d00320ed21eb89e98abce8ebbdaa7e4aa887e97ee97888ae8e4b62c69adf197`.
- Provider execution-link `sourceRevision` is the Domain-authoritative string in Domain, PostgreSQL,
  projector payload and generated JSON Schema.

## Safety and authority result

The tests prove exact reconciliation of an uncertain mutating MCP Task admission without ordinary
redispatch, at-most-one RemoteTaskBinding materialization, and immutable Provider execution lineage.
They do not call a real Provider or Device. Provider completion remains observation and cannot be
promoted to Goal or physical success.
