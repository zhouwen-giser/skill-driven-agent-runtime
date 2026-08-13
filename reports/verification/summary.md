# Verification Summary

- Status: **failed**
- Commit: `09941d263c12b5146ec30a628de3cad1ee99644d` (dirty working tree)
- Started: 2026-08-13T04:11:35.713Z
- Finished: 2026-08-13T04:15:14.237Z
- Duration: 218524 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 183697 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 761 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 28306 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 5756 ms |
