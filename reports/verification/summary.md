# Verification Summary

- Status: **passed**
- Commit: `4a7dfbd7a628ebd72a574b92f63815b4358d65ac` (dirty working tree)
- Started: 2026-07-16T16:04:06.237Z
- Finished: 2026-07-16T16:06:39.698Z
- Duration: 153461 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 52179 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 23489 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 16740 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 35770 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 8587 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 16695 ms |
