# Verification Summary

- Status: **passed**
- Commit: `f12573b9847a59a7c90e0e96ba38517f54a18731` (dirty working tree)
- Started: 2026-07-27T16:49:21.216Z
- Finished: 2026-07-27T16:52:49.378Z
- Duration: 208162 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 82361 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 645 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 14093 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 46607 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 40523 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 6821 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 17111 ms |
