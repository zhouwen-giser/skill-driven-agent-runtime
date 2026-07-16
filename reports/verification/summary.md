# Verification Summary

- Status: **passed**
- Commit: `2efbef687b2d2b7c068fba276aa6b8f3aa1b26f0` (dirty working tree)
- Started: 2026-07-16T10:30:46.969Z
- Finished: 2026-07-16T10:32:12.160Z
- Duration: 85191 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 45243 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 2682 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 5240 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 24846 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 603 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6577 ms |
