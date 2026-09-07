# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T05:50:07.470Z
- Finished: 2026-09-07T05:58:38.759Z
- Duration: 511289 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39897 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 3050 ms |
| lint | `pnpm lint` | passed | 195101 ms |
| typecheck | `pnpm typecheck` | passed | 58284 ms |
| unit | `pnpm test:unit` | passed | 167055 ms |
| contract | `pnpm test:contract` | failed | 47852 ms |
