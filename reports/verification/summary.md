# Verification Summary

- Status: **passed**
- Commit: `fe3b12608dfe3271aead4da07c71c174de140cd6` (dirty working tree)
- Started: 2026-07-16T10:54:03.534Z
- Finished: 2026-07-16T10:55:29.727Z
- Duration: 86193 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 44941 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 2731 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 5376 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 25946 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 586 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 6612 ms |
