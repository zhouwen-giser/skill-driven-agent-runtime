# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T17:45:59.344Z
- Finished: 2026-10-10T17:49:11.530Z
- Duration: 192186 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39170 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10223 ms |
| lint | `pnpm lint` | failed | 142784 ms |
