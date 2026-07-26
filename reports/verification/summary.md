# Verification Summary

- Status: **passed**
- Commit: `856f909d22c33e6e20d7e0a1cffc2f54c03b4477` (dirty working tree)
- Started: 2026-07-26T12:43:01.248Z
- Finished: 2026-07-26T12:45:43.106Z
- Duration: 161858 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 90456 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 712 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 7169 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 18548 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 33253 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 580 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 11139 ms |
