# Verification Summary

- Status: **passed**
- Commit: `a787cbf0130a74b894b88aba6706782b654c59ff`
- Started: 2026-08-03T02:53:23.311Z
- Finished: 2026-08-03T03:03:40.830Z
- Duration: 617519 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 202970 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1965 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 29863 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 160723 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 98501 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 7181 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 48642 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 67668 ms |
