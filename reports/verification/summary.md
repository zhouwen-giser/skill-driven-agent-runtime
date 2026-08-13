# Verification Summary

- Status: **failed**
- Commit: `9df1c22a4debfbb30d6cb5e0c072f2f0e5c3f780`
- Started: 2026-08-13T04:34:07.194Z
- Finished: 2026-08-13T04:41:05.214Z
- Duration: 418020 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 179440 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 744 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 21930 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 186992 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 28911 ms |
