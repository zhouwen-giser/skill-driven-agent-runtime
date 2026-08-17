# Verification Summary

- Status: **failed**
- Commit: `888ab8f2d7a5c95c27586673a65cc914919a0280` (dirty working tree)
- Started: 2026-08-17T02:06:50.006Z
- Finished: 2026-08-17T02:12:16.528Z
- Duration: 326522 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 292983 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 954 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 31767 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 815 ms |
