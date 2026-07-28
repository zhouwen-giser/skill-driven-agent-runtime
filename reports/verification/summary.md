# Verification Summary

- Status: **passed**
- Commit: `de25f4c9eb4d9cf96ab75bdaf0d1552a738c3187`
- Started: 2026-07-28T14:29:18.693Z
- Finished: 2026-07-28T14:32:59.082Z
- Duration: 220389 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 83970 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 669 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 13570 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 52652 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 41327 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 8394 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 19807 ms |
