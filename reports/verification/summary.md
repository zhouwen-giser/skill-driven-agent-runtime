# Verification Summary

- Status: **passed**
- Commit: `6f9abf88cf9b7d5489c076da4728fdcde0019243`
- Started: 2026-07-15T18:03:01.248Z
- Finished: 2026-07-15T18:05:01.016Z
- Duration: 119768 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 38991 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 11228 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 13750 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 31648 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 9160 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 14990 ms |
