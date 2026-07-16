# Verification Summary

- Status: **passed**
- Commit: `fa4b0509971fc73c474211b871eeefaf4e76eb54` (dirty working tree)
- Started: 2026-07-16T02:20:00.740Z
- Finished: 2026-07-16T02:21:17.134Z
- Duration: 76394 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 40238 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 2602 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 3721 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 22973 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 549 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6311 ms |
