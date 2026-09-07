# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T10:54:57.440Z
- Finished: 2026-09-07T10:58:37.998Z
- Duration: 220558 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 20871 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 2910 ms |
| lint | `pnpm lint` | passed | 87455 ms |
| typecheck | `pnpm typecheck` | passed | 25839 ms |
| unit | `pnpm test:unit` | failed | 83471 ms |
