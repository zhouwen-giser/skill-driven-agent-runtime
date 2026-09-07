# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T06:47:54.018Z
- Finished: 2026-09-07T06:49:35.577Z
- Duration: 101559 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 34987 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 2987 ms |
| lint | `pnpm lint` | failed | 63567 ms |
