# Verification Summary

- Status: **passed**
- Commit: `591cbe433c5cbd86882fa34688d491f900903a87` (dirty working tree)
- Started: 2026-07-26T18:10:06.041Z
- Finished: 2026-07-26T18:12:55.060Z
- Duration: 169019 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 84511 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 720 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 7039 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 32596 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 32982 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 524 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 10647 ms |
