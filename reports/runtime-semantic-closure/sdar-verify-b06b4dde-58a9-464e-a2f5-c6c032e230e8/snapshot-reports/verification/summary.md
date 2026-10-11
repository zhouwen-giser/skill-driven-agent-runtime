# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T16:53:36.231Z
- Finished: 2026-10-10T16:56:41.927Z
- Duration: 185696 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 38704 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10080 ms |
| lint | `pnpm lint` | failed | 136903 ms |
