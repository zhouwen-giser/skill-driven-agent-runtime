# Verification Summary

- Status: **passed**
- Commit: `aa060f318b77a375f20f32fbdea1629ac5511b55` (dirty working tree)
- Started: 2026-07-29T10:48:23.769Z
- Finished: 2026-07-29T10:51:39.442Z
- Duration: 195673 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 88526 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 693 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 6597 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 52504 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 33985 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 588 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 12779 ms |
