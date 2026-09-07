# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T06:16:15.874Z
- Finished: 2026-09-07T06:33:15.647Z
- Duration: 1019773 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 34140 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 2845 ms |
| lint | `pnpm lint` | passed | 143352 ms |
| typecheck | `pnpm typecheck` | passed | 49088 ms |
| unit | `pnpm test:unit` | passed | 162931 ms |
| contract | `pnpm test:contract` | passed | 41179 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 1449 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 623 ms |
| architecture | `pnpm verify:architecture` | passed | 1716 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 653 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 750 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 768 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 3845 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 767 ms |
| acceptance | `pnpm verify:acceptance` | passed | 536 ms |
| sources | `pnpm verify:sources` | passed | 677 ms |
| protocol | `pnpm verify:protocol` | passed | 812 ms |
| infra | `pnpm verify:infra` | passed | 783 ms |
| project-license | `pnpm verify:project-license` | passed | 591 ms |
| licenses | `pnpm verify:licenses` | passed | 1042 ms |
| build | `pnpm build` | passed | 48816 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 1690 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 164185 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 356487 ms |
