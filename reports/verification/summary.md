# Verification Summary

- Status: **passed**
- Commit: `b0caf69e9f83bc6702e1c0a85e7ca158c3781d4b` (dirty working tree)
- Started: 2026-08-31T11:22:49.682Z
- Finished: 2026-08-31T11:47:21.915Z
- Duration: 1472233 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 346233 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1107 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 59227 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 337849 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 266190 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 60148 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 257222 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 13599 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 56970 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 73680 ms |
