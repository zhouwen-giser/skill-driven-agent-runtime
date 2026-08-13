# Verification Summary

- Status: **failed**
- Commit: `48263487651cabf29ee7e4667a8a6ddb6eeac2fe`
- Started: 2026-08-13T14:41:24.087Z
- Finished: 2026-08-13T14:49:38.543Z
- Duration: 494456 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 197759 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 868 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 26175 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 208271 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 61379 ms |
