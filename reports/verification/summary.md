# Verification Summary

- Status: **passed**
- Commit: `a13d8e76aee1764abf9cb8d828be60f183341dc2` (dirty working tree)
- Started: 2026-07-16T11:50:24.654Z
- Finished: 2026-07-16T11:51:53.017Z
- Duration: 88363 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 45659 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 4201 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 5465 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 25764 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 549 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6725 ms |
