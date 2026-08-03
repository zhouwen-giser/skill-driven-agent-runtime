# Verification Summary

- Status: **passed**
- Commit: `ec10587073828b1fd940e475a30a8ceebfaedd57`
- Started: 2026-08-03T04:43:20.950Z
- Finished: 2026-08-03T04:54:26.101Z
- Duration: 665151 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 201910 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1392 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 29090 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 223265 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 109670 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 5590 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 29265 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 64962 ms |
