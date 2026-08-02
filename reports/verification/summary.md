# Verification Summary

- Status: **passed**
- Commit: `9e53ebb0e604558195b51a9cdd5e34d122c89848` (dirty working tree)
- Started: 2026-08-02T22:15:55.489Z
- Finished: 2026-08-02T22:22:26.803Z
- Duration: 391314 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 146462 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 773 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 21096 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 102976 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 53110 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 3223 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 19568 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 44102 ms |
