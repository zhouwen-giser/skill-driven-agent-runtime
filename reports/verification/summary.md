# Verification Summary

- Status: **failed**
- Commit: `6dc93f6f8162947f0228d9dc531f5c183fd87480` (dirty working tree)
- Started: 2026-08-13T16:24:15.739Z
- Finished: 2026-08-13T16:35:24.643Z
- Duration: 668904 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: operator-managed

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 170392 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 731 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 21548 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 189569 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | passed | 198517 ms |
| official-a2a-tck | `pnpm test:a2a-tck` | passed | 59322 ms |
| canonical-evidence-demo | `pnpm demo:evidence-e2e` | failed | 28822 ms |
