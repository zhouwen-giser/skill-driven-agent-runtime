# Verification Summary

- Status: **passed**
- Commit: `74344ceadfa28d3940118ec3cfdd437cde2e0b97`
- Started: 2026-07-18T13:32:49.867Z
- Finished: 2026-07-18T13:35:23.071Z
- Duration: 153204 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 54369 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 464 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 21285 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 16520 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 40030 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 6809 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 13727 ms |
