# Verification Summary

- Status: **failed**
- Commit: `15ed8ddecc485668a399acd8918d0a7d7b6f949b` (dirty working tree)
- Started: 2026-08-09T17:11:02.570Z
- Finished: 2026-08-09T17:20:00.961Z
- Duration: 538391 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 243342 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1183 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 35758 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 258103 ms |
