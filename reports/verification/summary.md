# Verification Summary

- Status: **passed**
- Commit: `dc636e66b5b5dbbadd99bfaebe2f5cc183d394be`
- Started: 2026-07-30T02:04:09.766Z
- Finished: 2026-07-30T02:08:44.989Z
- Duration: 275223 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 104876 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 742 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 14095 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 69379 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 51813 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 10826 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 23491 ms |
