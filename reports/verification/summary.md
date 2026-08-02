# Verification Summary

- Status: **passed**
- Commit: `f4099115694cee03c792c0f16590d95569b6e5fe` (dirty working tree)
- Started: 2026-08-02T09:18:47.565Z
- Finished: 2026-08-02T09:24:45.965Z
- Duration: 358400 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 133287 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 831 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 18777 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 86588 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 51482 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 2689 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 16711 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 48029 ms |
