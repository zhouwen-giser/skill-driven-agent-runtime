# Verification Summary

- Status: **failed**
- Commit: `7246c263bbb5554d01a7aa343ef6f857378e7bf4` (dirty working tree)
- Started: 2026-08-14T14:13:11.839Z
- Finished: 2026-08-14T14:17:20.861Z
- Duration: 249022 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 218666 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 767 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 28933 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 652 ms |
