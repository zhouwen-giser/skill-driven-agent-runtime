# Verification Summary

- Status: **failed**
- Commit: `6d6b41ea28d61f66c5406c39b2cfe507a2cb21e9`
- Started: 2026-08-13T04:24:48.624Z
- Finished: 2026-08-13T04:30:39.442Z
- Duration: 350818 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 181099 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 828 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 22566 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 146322 ms |
