# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T16:02:37.872Z
- Finished: 2026-10-10T16:09:24.106Z
- Duration: 406234 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39686 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10209 ms |
| lint | `pnpm lint` | passed | 138269 ms |
| typecheck | `pnpm typecheck` | passed | 45209 ms |
| unit | `pnpm test:unit` | passed | 128820 ms |
| contract | `pnpm test:contract` | failed | 44026 ms |
