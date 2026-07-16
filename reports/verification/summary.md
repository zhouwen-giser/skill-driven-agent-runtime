# Verification Summary

- Status: **passed**
- Commit: `8f7bba94138094fb3325267b792ea22f479ab178` (dirty working tree)
- Started: 2026-07-16T08:28:46.447Z
- Finished: 2026-07-16T08:30:13.938Z
- Duration: 87491 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 44481 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 4864 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 5123 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 25812 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 546 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6663 ms |
