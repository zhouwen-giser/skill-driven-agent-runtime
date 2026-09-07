# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T06:52:33.095Z
- Finished: 2026-09-07T06:57:46.444Z
- Duration: 313349 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 21594 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 2679 ms |
| lint | `pnpm lint` | passed | 96657 ms |
| typecheck | `pnpm typecheck` | passed | 38112 ms |
| unit | `pnpm test:unit` | passed | 110373 ms |
| contract | `pnpm test:contract` | passed | 27897 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 878 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 504 ms |
| architecture | `pnpm verify:architecture` | passed | 1199 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 519 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 512 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 563 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 2959 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 679 ms |
| acceptance | `pnpm verify:acceptance` | passed | 491 ms |
| sources | `pnpm verify:sources` | passed | 502 ms |
| protocol | `pnpm verify:protocol` | passed | 645 ms |
| infra | `pnpm verify:infra` | passed | 606 ms |
| project-license | `pnpm verify:project-license` | passed | 492 ms |
| licenses | `pnpm verify:licenses` | passed | 671 ms |
| build | `pnpm build` | failed | 4780 ms |
