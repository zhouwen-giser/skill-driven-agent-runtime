# Verification Summary

- Status: **passed**
- Commit: `764ec026564d31845273724ce1a29df4e0b5b675` (dirty working tree)
- Started: 2026-07-17T13:10:48.708Z
- Finished: 2026-07-17T13:12:34.847Z
- Duration: 106139 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 52868 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 466 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 8579 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 7323 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 29141 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 514 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 7247 ms |
