# Verification Summary

- Status: **passed**
- Commit: `ee521584318f1c7e3a25267b86728da1cf076747` (dirty working tree)
- Started: 2026-07-26T18:33:59.162Z
- Finished: 2026-07-26T18:36:46.369Z
- Duration: 167207 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 81786 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 786 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 9207 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 31812 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 31761 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 535 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 11319 ms |
