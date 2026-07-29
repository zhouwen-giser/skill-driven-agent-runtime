# Verification Summary

- Status: **passed**
- Commit: `ca033092485befe2a6d00e96bb08fee604a31961`
- Started: 2026-07-29T10:59:39.222Z
- Finished: 2026-07-29T11:03:08.141Z
- Duration: 208919 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 101373 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 666 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 5912 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 52366 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 34617 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 527 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 13458 ms |
