# Verification Summary

- Status: **passed**
- Commit: `39298c3798d6a14447b7a01e30eae0d3b13ae5f8` (dirty working tree)
- Started: 2026-08-02T18:00:34.622Z
- Finished: 2026-08-02T18:06:20.739Z
- Duration: 346117 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 121133 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 828 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 18858 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 88714 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 51543 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 2793 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 16738 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 45506 ms |
