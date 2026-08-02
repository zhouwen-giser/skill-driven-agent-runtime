# Verification Summary

- Status: **passed**
- Commit: `5ddc9939b5c3c4e786340df07571381a6443909e` (dirty working tree)
- Started: 2026-08-02T16:06:37.469Z
- Finished: 2026-08-02T16:14:38.632Z
- Duration: 481163 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 156163 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1124 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 30768 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 124978 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 74530 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 4655 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 31129 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 57812 ms |
