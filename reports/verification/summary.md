# Verification Summary

- Status: **passed**
- Commit: `b3b6e67d1e84ee462a57f209417521c6008be989`
- Started: 2026-07-18T14:08:18.893Z
- Finished: 2026-07-18T14:10:47.687Z
- Duration: 148794 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 54767 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 471 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 16302 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 15754 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 40943 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 6825 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 13732 ms |
