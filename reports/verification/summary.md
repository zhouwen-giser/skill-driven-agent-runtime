# Verification Summary

- Status: **failed**
- Commit: `3eb04437c1f2f8d2269866a03bf1f25f8975ee22`
- Started: 2026-08-13T14:22:27.328Z
- Finished: 2026-08-13T14:27:16.565Z
- Duration: 289237 ms
- Environment: Node v22.14.0, win32/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| static-unit-contract-build | `pnpm verify:bootstrap` | passed | 190355 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 811 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 22516 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 75551 ms |
