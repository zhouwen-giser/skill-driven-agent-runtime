# Verification Summary

- Status: **passed**
- Commit: `574e8e1f56afd021fbf5be52c7bd7913289f52cb` (dirty working tree)
- Started: 2026-08-01T19:39:39.737Z
- Finished: 2026-08-01T19:45:53.723Z
- Duration: 373986 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 111887 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 853 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 19715 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 93958 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 64846 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 13774 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 28283 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 40666 ms |
