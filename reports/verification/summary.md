# Verification Summary

- Status: **passed**
- Commit: `93a901eb6e6b7eb3bef895895bf5c68e4d5936a9`
- Started: 2026-08-03T00:09:40.893Z
- Finished: 2026-08-03T00:16:35.250Z
- Duration: 414357 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 138119 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1046 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 21124 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 119622 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 60641 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 3262 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 21158 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 49382 ms |
