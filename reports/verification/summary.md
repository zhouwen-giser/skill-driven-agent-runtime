# Verification Summary

- Status: **passed**
- Commit: `f97637b4152ef697785167b5df5aa09f9ab7deea` (dirty working tree)
- Started: 2026-07-16T22:34:59.586Z
- Finished: 2026-07-16T22:37:42.510Z
- Duration: 162924 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 62079 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 775 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 18289 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 18888 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 37410 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 9187 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 16294 ms |
