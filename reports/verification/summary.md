# Verification Summary

- Status: **passed**
- Commit: `f272285eae50ef46d841a2b1267c4f7764883306` (dirty working tree)
- Started: 2026-08-01T18:08:32.007Z
- Finished: 2026-08-01T18:14:40.187Z
- Duration: 368180 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 106417 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 818 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 25721 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 90958 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 63406 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 13606 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 27184 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 40065 ms |
