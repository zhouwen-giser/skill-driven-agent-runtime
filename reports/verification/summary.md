# Verification Summary

- Status: **failed**
- Commit: `a4dcf575273b3d259998f5bb6b0e4e1d67305d36` (dirty working tree)
- Started: 2026-08-13T23:07:33.291Z
- Finished: 2026-08-13T23:19:49.498Z
- Duration: 736207 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 180558 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 749 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 27015 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 204280 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 229296 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 67510 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | failed | 26795 ms |
