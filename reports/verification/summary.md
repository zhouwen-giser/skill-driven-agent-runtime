# Verification Summary

- Status: **failed**
- Commit: `2c8faf81045ffcbd3ebdd672232af4fba0127ff5`
- Started: 2026-08-02T23:34:20.988Z
- Finished: 2026-08-02T23:38:54.565Z
- Duration: 273577 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 142460 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 996 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 20611 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 109507 ms |
