# Verification Summary

- Status: **passed**
- Commit: `be9d01d7f6773f4d07fa26a7ab0de54c9fd7a0c2`
- Started: 2026-08-02T14:33:38.227Z
- Finished: 2026-08-02T14:40:21.666Z
- Duration: 403439 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 135890 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 947 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 21747 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 109335 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 64969 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 3193 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 20818 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 46538 ms |
