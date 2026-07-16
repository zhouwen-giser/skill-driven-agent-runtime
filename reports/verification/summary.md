# Verification Summary

- Status: **passed**
- Commit: `4007b38decd0b7b8f8a7f30b7331210cdf82819a` (dirty working tree)
- Started: 2026-07-16T14:19:25.297Z
- Finished: 2026-07-16T14:22:11.873Z
- Duration: 166576 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 50791 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 36622 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 15923 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 37100 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 9161 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 16976 ms |
