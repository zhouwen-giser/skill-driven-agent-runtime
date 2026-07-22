# Verification Summary

- Status: **failed**
- Commit: `3115643a2dfd9d8ac2956e24dd135c1c78f00dc5`
- Started: 2026-07-22T14:01:38.654Z
- Finished: 2026-07-22T14:03:20.921Z
- Duration: 102267 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 59885 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 3723 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 9022 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 29086 ms |
| infrastructure-smoke | `pnpm smoke:infra` | failed | 550 ms |
