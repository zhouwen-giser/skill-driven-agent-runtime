# Verification Summary

- Status: **passed**
- Commit: `667146a3639eefdfed9b89c2417c08e1ac50e9a9` (dirty working tree)
- Started: 2026-07-17T09:09:13.095Z
- Finished: 2026-07-17T09:11:43.896Z
- Duration: 150801 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 59521 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 500 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 20457 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 14647 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 33657 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 6859 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 15159 ms |
