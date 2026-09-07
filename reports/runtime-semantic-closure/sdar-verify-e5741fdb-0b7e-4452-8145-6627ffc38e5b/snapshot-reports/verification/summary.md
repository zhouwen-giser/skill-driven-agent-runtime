# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T07:07:45.735Z
- Finished: 2026-09-07T07:17:29.489Z
- Duration: 583754 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 23887 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 2992 ms |
| lint | `pnpm lint` | passed | 111305 ms |
| typecheck | `pnpm typecheck` | passed | 27306 ms |
| unit | `pnpm test:unit` | passed | 87233 ms |
| contract | `pnpm test:contract` | passed | 26289 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 842 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 495 ms |
| architecture | `pnpm verify:architecture` | passed | 1260 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 568 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 501 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 533 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 2902 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 624 ms |
| acceptance | `pnpm verify:acceptance` | passed | 497 ms |
| sources | `pnpm verify:sources` | passed | 721 ms |
| protocol | `pnpm verify:protocol` | passed | 748 ms |
| infra | `pnpm verify:infra` | passed | 592 ms |
| project-license | `pnpm verify:project-license` | passed | 528 ms |
| licenses | `pnpm verify:licenses` | passed | 700 ms |
| build | `pnpm build` | passed | 28870 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 772 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 35418 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 228133 ms |
