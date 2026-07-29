# Verification Summary

- Status: **passed**
- Commit: `fe41d60c3c6acc6557ba5a0d702dcb82f767a599` (dirty working tree)
- Started: 2026-07-29T15:57:04.197Z
- Finished: 2026-07-29T16:01:18.509Z
- Duration: 254312 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 98746 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 743 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 14493 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 63046 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 44343 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 10609 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 22332 ms |
