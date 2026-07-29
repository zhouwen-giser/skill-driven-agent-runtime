# Verification Summary

- Status: **passed**
- Commit: `26b60c2129f9fbfd30e363e113991962bd91e9b4` (dirty working tree)
- Started: 2026-07-29T13:49:39.953Z
- Finished: 2026-07-29T13:53:20.067Z
- Duration: 220114 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 103576 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 672 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 5752 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 57848 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 36315 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 545 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 15406 ms |
