# Verification Summary

- Status: **passed**
- Commit: `21b9f792eb379219c842fe6521764f1b396300c6` (dirty working tree)
- Started: 2026-07-16T11:37:39.520Z
- Finished: 2026-07-16T11:39:08.531Z
- Duration: 89011 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 45779 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 5044 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 5434 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 25578 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 538 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6638 ms |
