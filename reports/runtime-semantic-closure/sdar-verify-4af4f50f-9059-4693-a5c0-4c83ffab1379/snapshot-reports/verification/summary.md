# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T10:51:13.893Z
- Finished: 2026-09-07T10:53:22.646Z
- Duration: 128753 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 22655 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 2995 ms |
| lint | `pnpm lint` | failed | 103094 ms |
