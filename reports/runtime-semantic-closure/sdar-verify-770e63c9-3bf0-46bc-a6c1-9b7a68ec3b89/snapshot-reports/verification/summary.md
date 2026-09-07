# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T05:38:19.142Z
- Finished: 2026-09-07T05:46:21.829Z
- Duration: 482687 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 62525 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 3967 ms |
| lint | `pnpm lint` | passed | 176368 ms |
| typecheck | `pnpm typecheck` | passed | 58048 ms |
| unit | `pnpm test:unit` | failed | 181734 ms |
