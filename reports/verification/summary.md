# Verification Summary

- Status: **passed**
- Commit: `6decc5ddac57a64485b3a61a7fcbfb38da180282` (dirty working tree)
- Started: 2026-07-16T03:10:12.178Z
- Finished: 2026-07-16T03:11:31.079Z
- Duration: 78901 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 41416 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 3458 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 3804 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 23306 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 533 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6384 ms |
