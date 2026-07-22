# Verification Summary

- Status: **passed**
- Commit: `2db399693b2754f17a2ecc78356f3aab19f1297b`
- Started: 2026-07-22T14:19:23.213Z
- Finished: 2026-07-22T14:21:12.331Z
- Duration: 109118 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 59686 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 3390 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 8916 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 28625 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 516 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 7984 ms |
