# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T06:01:28.656Z
- Finished: 2026-09-07T06:09:17.790Z
- Duration: 469134 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 40094 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 3143 ms |
| lint | `pnpm lint` | passed | 172389 ms |
| typecheck | `pnpm typecheck` | passed | 45891 ms |
| unit | `pnpm test:unit` | passed | 155815 ms |
| contract | `pnpm test:contract` | passed | 45609 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 1638 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 943 ms |
| architecture | `pnpm verify:architecture` | passed | 1886 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 837 ms |
| management-openapi | `pnpm verify:management-openapi` | failed | 853 ms |
