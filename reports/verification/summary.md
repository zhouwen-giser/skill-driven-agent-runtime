# Verification Summary

- Status: **passed**
- Commit: `bd9f951349fae51883efe686862c698600fed8bb` (dirty working tree)
- Started: 2026-07-16T17:10:38.498Z
- Finished: 2026-07-16T17:12:31.171Z
- Duration: 112673 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 61073 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 7210 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 8871 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 26494 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 575 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 8448 ms |
