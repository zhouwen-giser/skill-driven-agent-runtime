# Verification Summary

- Status: **passed**
- Commit: `d544691cb40325e695525f81184eef8be1e7db16` (dirty working tree)
- Started: 2026-08-02T02:09:00.583Z
- Finished: 2026-08-02T02:14:55.121Z
- Duration: 354538 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 121089 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 889 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 20102 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 86135 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 56132 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 3221 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 22021 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 44945 ms |
