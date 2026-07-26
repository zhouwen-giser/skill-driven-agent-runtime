# Verification Summary

- Status: **passed**
- Commit: `e740fa18f621cca782704d794cee05b4643afc63` (dirty working tree)
- Started: 2026-07-26T18:53:28.635Z
- Finished: 2026-07-26T18:56:14.369Z
- Duration: 165734 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 80909 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 677 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 7247 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 32700 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 33163 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 514 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 10524 ms |
