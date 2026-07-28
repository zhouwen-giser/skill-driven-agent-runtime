# Verification Summary

- Status: **passed**
- Commit: `5b8e4c781a56882fb73553836116354dee80e616` (dirty working tree)
- Started: 2026-07-28T14:16:10.304Z
- Finished: 2026-07-28T14:19:53.282Z
- Duration: 222978 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 84349 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 647 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 13761 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 53514 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 41823 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 8468 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 20415 ms |
