# Verification Summary

- Status: **passed**
- Commit: `61142f9a776a73ac5cccee97f3a47a0f62f1ed79`
- Started: 2026-07-22T01:00:42.398Z
- Finished: 2026-07-22T01:03:47.032Z
- Duration: 184634 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 58608 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 476 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 37118 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 21919 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 40380 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 9218 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 16913 ms |
