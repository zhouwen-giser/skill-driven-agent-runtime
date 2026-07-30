# Verification Summary

- Status: **passed**
- Commit: `b116a6c6d8cc63df50672e87f6b7aa8bccde8fa9`
- Started: 2026-07-30T01:44:30.322Z
- Finished: 2026-07-30T01:49:03.507Z
- Duration: 273185 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 101078 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 693 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 14747 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 70005 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 52185 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 11162 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 23313 ms |
