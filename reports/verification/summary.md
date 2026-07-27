# Verification Summary

- Status: **passed**
- Commit: `e926445b645b6425d246eb019e05f06a7c7c5f8e` (dirty working tree)
- Started: 2026-07-27T15:44:20.528Z
- Finished: 2026-07-27T15:48:03.306Z
- Duration: 222778 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 94227 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 664 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 8553 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 51494 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 40838 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 6810 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 20192 ms |
