# Verification Summary

- Status: **failed**
- Commit: `a9957c82c17ca01e77528f3817c03d86224aaf88` (dirty working tree)
- Started: 2026-08-11T04:21:11.197Z
- Finished: 2026-08-11T04:41:19.158Z
- Duration: 1207961 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 409569 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1762 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 45686 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 395001 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 355938 ms |
