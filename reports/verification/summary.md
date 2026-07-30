# Verification Summary

- Status: **passed**
- Commit: `211b88bba8188955c31fe38b62b599e89f9d0685`
- Started: 2026-07-29T23:46:00.558Z
- Finished: 2026-07-29T23:50:29.840Z
- Duration: 269282 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 103419 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 834 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 15308 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 69815 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 45088 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 11317 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 23500 ms |
