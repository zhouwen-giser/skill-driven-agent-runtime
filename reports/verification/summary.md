# Verification Summary

- Status: **passed**
- Commit: `f5be34fb3a1ef74d3564f496d93d07e3eee1bdda` (dirty working tree)
- Started: 2026-08-02T10:43:53.887Z
- Finished: 2026-08-02T10:49:43.641Z
- Duration: 349754 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 122605 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 799 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 18396 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 87235 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 51437 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 2702 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 16504 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 50072 ms |
