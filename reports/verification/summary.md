# Verification Summary

- Status: **passed**
- Commit: `35cb9277396e0316b1c6b8aac57e6fa69a8a29df` (dirty working tree)
- Started: 2026-07-22T16:58:54.528Z
- Finished: 2026-07-22T17:01:43.404Z
- Duration: 168876 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 65985 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 19562 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 20838 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 35866 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 9294 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 17331 ms |
