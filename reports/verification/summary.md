# Verification Summary

- Status: **passed**
- Commit: `2ec8987117e112eeb50e0d5fac7ecca612301358` (dirty working tree)
- Started: 2026-07-22T18:34:12.276Z
- Finished: 2026-07-22T18:36:52.243Z
- Duration: 159967 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 99644 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 6132 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 12518 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 30604 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 562 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 10506 ms |
