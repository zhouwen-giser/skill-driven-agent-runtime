# Verification Summary

- Status: **failed**
- Commit: `2ada1815cee8f3b5748a3bb0418f706a5a4f9e69`
- Started: 2026-07-22T00:54:32.448Z
- Finished: 2026-07-22T00:57:21.924Z
- Duration: 169476 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 67616 ms |
| v1.1-mcp-tasks-acceptance-map | `pnpm verify:v11-acceptance` | passed | 538 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 38288 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 22146 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 40887 ms |
