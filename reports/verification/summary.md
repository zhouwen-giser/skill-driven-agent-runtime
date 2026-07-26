# Verification Summary

- Status: **passed**
- Commit: `7e505412bc50917a71c4a724ef15f659c6d5c296`
- Started: 2026-07-26T11:41:21.123Z
- Finished: 2026-07-26T11:44:12.268Z
- Duration: 171145 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 98172 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 752 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 7104 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 18278 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 33468 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 559 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 12811 ms |
