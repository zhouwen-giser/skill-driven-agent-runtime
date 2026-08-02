# Verification Summary

- Status: **passed**
- Commit: `6a925f2c6a3b63044724532eb719507be27f46ca` (dirty working tree)
- Started: 2026-08-02T00:31:56.908Z
- Finished: 2026-08-02T00:37:36.445Z
- Duration: 339537 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 123617 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 788 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 19434 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 83151 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 49742 ms |
| infrastructure-smoke | `pnpm smoke:infra` | passed | 2750 ms |
| server-console-smoke | `pnpm smoke:server` | passed | 16426 ms |
| node-control-api-worker-smoke | `pnpm smoke:node-control` | passed | 43626 ms |
