# Verification Summary

- Status: **failed**
- Commit: `24b94211745c097d4bad2ef7da246b45d1deae2b` (dirty working tree)
- Started: 2026-07-22T13:47:12.847Z
- Finished: 2026-07-22T13:48:59.386Z
- Duration: 106539 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 61297 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 3593 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 9056 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 32593 ms |
