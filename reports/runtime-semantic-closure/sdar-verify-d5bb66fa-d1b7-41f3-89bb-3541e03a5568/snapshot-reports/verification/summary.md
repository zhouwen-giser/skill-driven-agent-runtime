# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T12:45:58.620Z
- Finished: 2026-10-10T12:49:19.323Z
- Duration: 200703 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 51598 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10024 ms |
| lint | `pnpm lint` | failed | 139071 ms |
