# Verification Summary

- Status: **failed**
- Commit: `710cb25d9e365c6a1a30a532d22deac787a7c3b0` (dirty working tree)
- Started: 2026-08-14T11:00:24.203Z
- Finished: 2026-08-14T11:12:19.944Z
- Duration: 715741 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 238124 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1104 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 31904 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 241165 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 203439 ms |
