# Verification Summary

- Status: **passed**
- Commit: `cf153bc0a6298582dc2d130b16f1ad4c94b64991` (dirty working tree)
- Started: 2026-07-16T00:48:08.959Z
- Finished: 2026-07-16T00:50:38.303Z
- Duration: 149344 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 42770 ms |
| empty-and-upgrade-migrations | `pnpm verify:migrations` | passed | 35698 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 14507 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 31731 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 9007 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 15631 ms |
