# Verification Summary

- Status: **passed**
- Commit: `cc0719f4db83dc64dc6e32e6dcad2d558823e796` (dirty working tree)
- Started: 2026-08-03T16:05:41.895Z
- Finished: 2026-08-03T16:16:42.112Z
- Duration: 660217 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 206454 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1108 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 32136 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 184654 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 106782 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 15622 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 42413 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 71045 ms |
