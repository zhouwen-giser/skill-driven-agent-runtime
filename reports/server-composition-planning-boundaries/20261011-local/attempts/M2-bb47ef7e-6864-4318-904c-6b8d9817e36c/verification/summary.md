# Verification Summary

- Status: **failed**
- Commit: `a230bac9b61e6cf901a91c094dbfe63704717fce` (dirty working tree)
- Started: 2026-10-11T04:51:48.633Z
- Finished: 2026-10-11T05:01:37.177Z
- Duration: 588544 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 40861 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10449 ms |
| lint | `pnpm lint` | passed | 139435 ms |
| typecheck | `pnpm typecheck` | passed | 48041 ms |
| unit | `pnpm test:unit` | passed | 133484 ms |
| contract | `pnpm test:contract` | passed | 43691 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 9480 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7716 ms |
| architecture | `pnpm verify:architecture` | passed | 5550 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7408 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7418 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7523 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10343 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7561 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4964 ms |
| sources | `pnpm verify:sources` | passed | 7364 ms |
| protocol | `pnpm verify:protocol` | passed | 5352 ms |
| infra | `pnpm verify:infra` | passed | 7661 ms |
| project-license | `pnpm verify:project-license` | passed | 4751 ms |
| licenses | `pnpm verify:licenses` | passed | 7566 ms |
| build | `pnpm build` | passed | 46766 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7785 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | failed | 17342 ms |
