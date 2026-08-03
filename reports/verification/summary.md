# Verification Summary

- Status: **passed**
- Commit: `beb616831093546aaac3b4c9894a776ecc49af39` (dirty working tree)
- Started: 2026-08-03T18:30:16.465Z
- Finished: 2026-08-03T18:39:30.275Z
- Duration: 553810 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 190640 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1143 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 27613 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 145955 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 83592 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 3844 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 32319 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 68699 ms |
