# Verification Summary

- Status: **passed**
- Commit: `5cef3a04b7237ac126f7e9d0548347b0d5c25baa`
- Started: 2026-07-30T04:14:17.346Z
- Finished: 2026-07-30T04:19:11.064Z
- Duration: 293718 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 110398 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 694 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 14374 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 75046 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 56817 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 11027 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 25362 ms |
