# Verification Summary

- Status: **failed**
- Commit: `97dc0ad4c4b577d82cdde638ea46348520333315`
- Started: 2026-08-13T04:18:05.784Z
- Finished: 2026-08-13T04:21:30.502Z
- Duration: 204718 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 178221 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 751 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 23139 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 2604 ms |
