# Verification Summary

- Status: **failed**
- Commit: `a230bac9b61e6cf901a91c094dbfe63704717fce` (dirty working tree)
- Started: 2026-10-11T03:52:50.830Z
- Finished: 2026-10-11T03:59:52.506Z
- Duration: 421676 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 38540 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 11154 ms |
| lint | `pnpm lint` | passed | 145772 ms |
| typecheck | `pnpm typecheck` | passed | 46223 ms |
| unit | `pnpm test:unit` | passed | 136763 ms |
| contract | `pnpm test:contract` | failed | 43208 ms |
