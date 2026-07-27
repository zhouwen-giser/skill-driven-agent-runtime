# Verification Summary

- Status: **failed**
- Commit: `1f7e043674081c2c8795e7ba6d142808abc6ff01`
- Started: 2026-07-27T13:07:31.151Z
- Finished: 2026-07-27T13:10:16.472Z
- Duration: 165321 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 82871 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 668 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 7407 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 40333 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 33394 ms |
| infrastructure-smoke | `pnpm smoke:infra` | failed | 648 ms |
