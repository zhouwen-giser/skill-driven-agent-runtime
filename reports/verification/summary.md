# Verification Summary

- Status: **passed**
- Commit: `0868821462a32043b6badf65714716302be6a3ac` (dirty working tree)
- Started: 2026-08-10T12:02:25.425Z
- Finished: 2026-08-10T12:22:38.870Z
- Duration: 1213445 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 223674 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1153 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 28672 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 223092 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 189713 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 80863 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 331261 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 7677 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 38501 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 88832 ms |
