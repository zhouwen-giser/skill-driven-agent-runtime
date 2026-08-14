# Verification Summary

- Status: **passed**
- Commit: `c2622c62607aaa02df62ae1f6b71998cf4f92688` (dirty working tree)
- Started: 2026-08-14T00:13:49.475Z
- Finished: 2026-08-14T00:30:29.818Z
- Duration: 1000343 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 199523 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 734 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 22248 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 203233 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 210811 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 62397 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 213032 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 3196 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 27495 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 57670 ms |
