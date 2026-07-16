# Verification Summary

- Status: **passed**
- Commit: `2eba64ec49d397b20eb5b07c0e9f3222c7166221` (dirty working tree)
- Started: 2026-07-16T10:19:49.972Z
- Finished: 2026-07-16T10:21:16.672Z
- Duration: 86700 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 46828 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 2772 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 5216 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 24771 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 528 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6585 ms |
