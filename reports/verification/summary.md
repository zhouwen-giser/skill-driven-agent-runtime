# Verification Summary

- Status: **failed**
- Commit: `b99ce47291224d546f540baa2429e928075f687e`
- Started: 2026-08-13T04:50:37.392Z
- Finished: 2026-08-13T04:57:53.877Z
- Duration: 436485 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 181963 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 828 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 22417 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 187294 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 43979 ms |
