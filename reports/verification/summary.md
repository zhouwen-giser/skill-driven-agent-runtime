# Verification Summary

- Status: **failed**
- Commit: `702baab3c3f7392b2f008155c267f5ef8f0786f6` (dirty working tree)
- Started: 2026-07-26T11:36:53.547Z
- Finished: 2026-07-26T11:39:30.066Z
- Duration: 156519 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 97090 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 704 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 6914 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 17992 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 33207 ms |
| infrastructure-smoke | `pnpm smoke:infra` | failed | 612 ms |
