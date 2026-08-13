# Verification Summary

- Status: **passed**
- Commit: `9841e6527330920d44f19c68214988b56db3c6eb` (dirty working tree)
- Started: 2026-08-13T23:37:10.887Z
- Finished: 2026-08-13T23:52:59.593Z
- Duration: 948706 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 175418 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 768 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 21408 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 192630 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 179833 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 59649 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | passed | 219077 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 3679 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 30625 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 65614 ms |
