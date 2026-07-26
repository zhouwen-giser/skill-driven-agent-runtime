# Verification Summary

- Status: **passed**
- Commit: `a8d53ff2a6d1de2e72d508ab35c40cd90f006618` (dirty working tree)
- Started: 2026-07-26T16:11:18.214Z
- Finished: 2026-07-26T16:13:44.436Z
- Duration: 146222 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 78092 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 641 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 6811 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 16736 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 33391 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 537 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 10014 ms |
