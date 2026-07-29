# Verification Summary

- Status: **passed**
- Commit: `3244647856df98411c5e3de7435ec382d2ca333f`
- Started: 2026-07-29T22:21:16.816Z
- Finished: 2026-07-29T22:25:49.142Z
- Duration: 272326 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 105034 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 740 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 15045 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 67694 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 48366 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 11312 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 24134 ms |
