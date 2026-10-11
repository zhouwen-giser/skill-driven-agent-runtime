# Verification Summary

- Status: **failed**
- Commit: `a230bac9b61e6cf901a91c094dbfe63704717fce` (dirty working tree)
- Started: 2026-10-11T04:09:23.570Z
- Finished: 2026-10-11T04:12:42.734Z
- Duration: 199164 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 38475 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10318 ms |
| lint | `pnpm lint` | failed | 150362 ms |
