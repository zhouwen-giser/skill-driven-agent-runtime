# Verification Summary

- Status: **passed**
- Commit: `0c439574ca84bb4f29c0032321254c0d2fd767da` (dirty working tree)
- Started: 2026-07-15T17:59:49.111Z
- Finished: 2026-07-15T18:01:49.646Z
- Duration: 120535 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 39712 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 11278 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 13682 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 31625 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 9286 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 14951 ms |
