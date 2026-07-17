# Verification Summary

- Status: **passed**
- Commit: `389d43d04c5c133791a789dec1c4e7417d65d625` (dirty working tree)
- Started: 2026-07-17T11:14:32.872Z
- Finished: 2026-07-17T11:16:53.877Z
- Duration: 141005 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 51091 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 482 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 20333 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 13802 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 35056 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 6828 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 13413 ms |
