# Verification Summary

- Status: **passed**
- Commit: `c434e4b43bfd2e892e6c831108456056a00c8e76` (dirty working tree)
- Started: 2026-07-30T04:08:36.557Z
- Finished: 2026-07-30T04:13:35.132Z
- Duration: 298575 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 113228 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 714 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 15151 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 75255 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 58506 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 11143 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 24575 ms |
