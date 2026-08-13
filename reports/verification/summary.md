# Verification Summary

- Status: **passed**
- Commit: `aa4231d2fb98050eaf1fbc5f9c77ef76ca7bf7bd` (dirty working tree)
- Started: 2026-08-13T16:59:12.617Z
- Finished: 2026-08-13T17:14:31.040Z
- Duration: 918423 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 173075 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 741 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 21416 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 185930 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 195914 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 59364 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 194804 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 2979 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 25116 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 59081 ms |
