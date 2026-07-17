# Verification Summary

- Status: **passed**
- Commit: `efb03e8893f037d2bca1ca2803422431711b5660`
- Started: 2026-07-17T13:19:45.568Z
- Finished: 2026-07-17T13:21:32.364Z
- Duration: 106796 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 52601 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 456 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 8644 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 7357 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 29497 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 514 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 7726 ms |
