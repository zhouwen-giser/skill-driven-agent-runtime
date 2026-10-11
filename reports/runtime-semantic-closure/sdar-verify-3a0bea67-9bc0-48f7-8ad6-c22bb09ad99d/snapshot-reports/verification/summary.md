# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T15:47:46.270Z
- Finished: 2026-10-10T15:54:34.640Z
- Duration: 408370 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 40896 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10996 ms |
| lint | `pnpm lint` | passed | 133791 ms |
| typecheck | `pnpm typecheck` | passed | 47849 ms |
| unit | `pnpm test:unit` | passed | 130796 ms |
| contract | `pnpm test:contract` | failed | 44026 ms |
