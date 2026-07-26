# Verification Summary

- Status: **passed**
- Commit: `14abffe75ed1e7108bfe59f7ceeeafed43a0ac45`
- Started: 2026-07-26T18:58:00.267Z
- Finished: 2026-07-26T19:00:50.923Z
- Duration: 170656 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 86603 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 666 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 7058 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 32358 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 32968 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 528 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 10475 ms |
