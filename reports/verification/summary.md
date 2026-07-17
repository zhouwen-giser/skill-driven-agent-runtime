# Verification Summary

- Status: **passed**
- Commit: `13194b89f3be7e39ec9a0609db5eec4ccb553538`
- Started: 2026-07-16T22:41:35.274Z
- Finished: 2026-07-16T22:44:17.275Z
- Duration: 162001 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 56122 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 509 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 24446 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 19010 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 36373 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 8511 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 17029 ms |
