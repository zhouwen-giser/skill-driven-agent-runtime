# Verification Summary

- Status: **failed**
- Commit: `08b552c651d2e90404459036d9ae88154a969975`
- Started: 2026-07-22T14:04:43.472Z
- Finished: 2026-07-22T14:06:33.659Z
- Duration: 110187 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 59735 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 3500 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 9106 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 29225 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 513 ms |
| server-console-smoke | `pnpm smoke:server` | failed | 8106 ms |
