# Verification Summary

- Status: **passed**
- Commit: `41215fb1097e889f01d3c14fbe90a04748335989` (dirty working tree)
- Started: 2026-07-22T17:46:48.450Z
- Finished: 2026-07-22T17:49:35.289Z
- Duration: 166839 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 72248 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 13403 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 19056 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 34993 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 9076 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 18062 ms |
