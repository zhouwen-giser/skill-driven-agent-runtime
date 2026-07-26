# Verification Summary

- Status: **passed**
- Commit: `659a5f1e42033fa9d550f00889bf058d499f8ab1` (dirty working tree)
- Started: 2026-07-26T17:19:09.561Z
- Finished: 2026-07-26T17:22:16.474Z
- Duration: 186913 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 96075 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 934 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 7800 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 33435 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 34608 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 973 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 13086 ms |
