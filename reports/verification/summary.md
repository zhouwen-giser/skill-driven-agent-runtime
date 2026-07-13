# Verification Summary

- Status: **passed**
- Commit: `ca9d9b9d3babd28816b3a2e9776e4f2b5c9d02d2` (dirty working tree)
- Started: 2026-07-13T16:11:49.362Z
- Finished: 2026-07-13T16:13:41.478Z
- Duration: 112116 ms
- Environment: Node v22.14.0, win32/x64

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 35458 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 10430 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 12645 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 29827 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 9946 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 13810 ms |
