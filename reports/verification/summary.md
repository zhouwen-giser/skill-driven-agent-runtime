# Verification Summary

- Status: **passed**
- Commit: `663bd1929932c0749d9ce56f22a96a186a2b47a3`
- Started: 2026-07-13T16:34:59.377Z
- Finished: 2026-07-13T16:36:57.231Z
- Duration: 117854 ms
- Environment: Node v22.14.0, win32/x64

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 37963 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 11198 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 13379 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 30863 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 10095 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 14356 ms |
