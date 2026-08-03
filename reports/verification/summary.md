# Verification Summary

- Status: **failed**
- Commit: `7eb5b83ce042244e6d70eb928ad5d456121f4ebf`
- Started: 2026-08-03T02:45:17.006Z
- Finished: 2026-08-03T02:51:53.140Z
- Duration: 396134 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 156404 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1059 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 27026 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 139815 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 70538 ms |
| infrastructure-smoke | `pnpm smoke:infra` | failed | 1290 ms |
