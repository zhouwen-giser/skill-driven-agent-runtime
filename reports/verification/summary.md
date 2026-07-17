# Verification Summary

- Status: **passed**
- Commit: `a65d27007ecdcb431d1a637df3b78a6ec7c55958` (dirty working tree)
- Started: 2026-07-17T11:02:22.910Z
- Finished: 2026-07-17T11:04:42.318Z
- Duration: 139408 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 51427 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 456 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 20405 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 14006 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 32937 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 6813 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 13362 ms |
