# Verification Summary

- Status: **passed**
- Commit: `363c3d1ffea7c3f7fdad97c9b1d55250ccdf8336`
- Started: 2026-08-02T23:50:37.612Z
- Finished: 2026-08-02T23:57:32.075Z
- Duration: 414463 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 140767 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1013 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 20611 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 110427 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 66531 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 3175 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 21132 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 50800 ms |
