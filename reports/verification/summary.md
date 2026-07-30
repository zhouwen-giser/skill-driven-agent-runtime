# Verification Summary

- Status: **passed**
- Commit: `c62334a25d7fb01f46c417f1767d4cc30a4e98c3`
- Started: 2026-07-30T01:57:08.923Z
- Finished: 2026-07-30T02:01:45.412Z
- Duration: 276489 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 103853 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 660 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 14966 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 69764 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 51911 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 11302 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 24032 ms |
