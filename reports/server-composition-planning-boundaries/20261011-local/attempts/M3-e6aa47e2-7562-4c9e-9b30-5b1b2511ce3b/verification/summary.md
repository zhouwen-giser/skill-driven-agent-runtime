# Verification Summary

- Status: **failed**
- Commit: `a230bac9b61e6cf901a91c094dbfe63704717fce` (dirty working tree)
- Started: 2026-10-11T04:39:43.124Z
- Finished: 2026-10-11T04:42:54.514Z
- Duration: 191390 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 41612 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10151 ms |
| lint | `pnpm lint` | failed | 139616 ms |
