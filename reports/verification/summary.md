# Verification Summary

- Status: **passed**
- Commit: `55a338204a6e2b2dabbd9cf9bc5e3cf9ca74de57`
- Started: 2026-07-28T19:33:43.614Z
- Finished: 2026-07-28T19:36:55.147Z
- Duration: 191533 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 88927 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 656 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 5309 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 49473 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 33947 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 515 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 12706 ms |
