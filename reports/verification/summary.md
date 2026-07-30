# Verification Summary

- Status: **passed**
- Commit: `3361ff84de6310a48543a0b72475e64fc547f668`
- Started: 2026-07-30T00:33:04.118Z
- Finished: 2026-07-30T00:37:27.551Z
- Duration: 263433 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 100678 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 687 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 14902 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 67776 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 45007 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 11080 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 23301 ms |
