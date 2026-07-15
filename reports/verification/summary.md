# Verification Summary

- Status: **passed**
- Commit: `bc4b44a7c8187d8d5e3f589f7bb9490a67cf0ad6`
- Started: 2026-07-15T04:49:12.679Z
- Finished: 2026-07-15T04:50:26.744Z
- Duration: 74065 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 39436 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 2528 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 3414 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 22029 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 567 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6091 ms |
