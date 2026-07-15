# Verification Summary

- Status: **passed**
- Commit: `53f025a15396bf429a1e71f38e3d1465f6845dfa` (dirty working tree)
- Started: 2026-07-15T23:48:58.655Z
- Finished: 2026-07-15T23:50:54.103Z
- Duration: 115448 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 41662 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 5402 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 13974 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 31119 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 8645 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 14645 ms |
