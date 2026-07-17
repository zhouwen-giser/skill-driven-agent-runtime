# Verification Summary

- Status: **passed**
- Commit: `72af560b87589cd1cedcfc6affd6eb3fdc61f548` (dirty working tree)
- Started: 2026-07-17T09:44:55.116Z
- Finished: 2026-07-17T09:47:24.288Z
- Duration: 149172 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 58950 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 512 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 20790 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 15230 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 33060 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 6836 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 13794 ms |
