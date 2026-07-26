# Verification Summary

- Status: **passed**
- Commit: `8ac5f5e35982d6406290302c1a095a79d1031aa1`
- Started: 2026-07-26T16:19:25.460Z
- Finished: 2026-07-26T16:22:20.333Z
- Duration: 174873 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 99516 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 744 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 7024 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 19893 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 35471 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 538 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 11687 ms |
