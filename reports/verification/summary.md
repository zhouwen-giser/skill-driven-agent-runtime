# Verification Summary

- Status: **passed**
- Commit: `14eb9785399ba632351b1c2bd7446dfee956c07d` (dirty working tree)
- Started: 2026-07-28T19:19:32.420Z
- Finished: 2026-07-28T19:22:44.080Z
- Duration: 191660 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 88393 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 675 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 5446 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 49466 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 34083 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 517 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 13078 ms |
