# Verification Summary

- Status: **passed**
- Commit: `c25e92b2043b8b426bdfa9316a0cc76a078c8098` (dirty working tree)
- Started: 2026-07-15T09:07:11.305Z
- Finished: 2026-07-15T09:08:30.531Z
- Duration: 79226 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 43907 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 2483 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 3771 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 22011 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 563 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6491 ms |
