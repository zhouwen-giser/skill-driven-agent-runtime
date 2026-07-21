# Verification Summary

- Status: **passed**
- Commit: `c979feb7a5ddd56cefcf126a763c370e626170fd` (dirty working tree)
- Started: 2026-07-21T18:07:56.255Z
- Finished: 2026-07-21T18:11:23.355Z
- Duration: 207100 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 68743 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 516 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 39748 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 24617 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 45294 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 9318 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 18862 ms |
