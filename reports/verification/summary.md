# Verification Summary

- Status: **failed**
- Commit: `b8fc6c20b95114007eab86305aa4e34863f1334d` (dirty working tree)
- Started: 2026-08-12T07:44:41.768Z
- Finished: 2026-08-12T07:52:33.828Z
- Duration: 472060 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 248317 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 751 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 46884 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 176105 ms |
