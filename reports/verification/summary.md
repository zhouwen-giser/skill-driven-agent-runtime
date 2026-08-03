# Verification Summary

- Status: **passed**
- Commit: `ffb49321db145e6c7572983755075540bf74bb40` (dirty working tree)
- Started: 2026-08-03T19:34:12.795Z
- Finished: 2026-08-03T19:44:13.883Z
- Duration: 601088 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 199247 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1261 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 26849 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 163432 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 97332 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 6529 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 33646 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 72786 ms |
