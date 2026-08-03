# Verification Summary

- Status: **passed**
- Commit: `e6d0b698fb0430386edba66474f8214f9f4bd740`
- Started: 2026-08-03T05:40:03.711Z
- Finished: 2026-08-03T05:49:45.496Z
- Duration: 581785 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 203514 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1145 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 26565 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 157252 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 85789 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 4583 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 33293 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 69638 ms |
