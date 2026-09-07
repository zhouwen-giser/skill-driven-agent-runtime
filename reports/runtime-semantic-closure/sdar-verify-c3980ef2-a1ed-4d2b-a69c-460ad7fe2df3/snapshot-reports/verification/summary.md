# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T11:03:08.835Z
- Finished: 2026-09-07T11:07:55.516Z
- Duration: 286681 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 24705 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 3011 ms |
| lint | `pnpm lint` | passed | 100167 ms |
| typecheck | `pnpm typecheck` | passed | 29562 ms |
| unit | `pnpm test:unit` | passed | 104646 ms |
| contract | `pnpm test:contract` | failed | 24579 ms |
