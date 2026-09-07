# Verification Summary

- Status: **failed**
- Commit: `473ad7d82cb11eda530aaa46d77478850bd1e51e` (dirty working tree)
- Started: 2026-09-07T11:11:05.329Z
- Finished: 2026-09-07T11:20:00.376Z
- Duration: 535047 ms
- Environment: Node v22.23.1, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 21198 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 2938 ms |
| lint | `pnpm lint` | passed | 86417 ms |
| typecheck | `pnpm typecheck` | passed | 26614 ms |
| unit | `pnpm test:unit` | passed | 87083 ms |
| contract | `pnpm test:contract` | passed | 24834 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 884 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 499 ms |
| architecture | `pnpm verify:architecture` | passed | 1198 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 481 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 476 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 511 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 2813 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 589 ms |
| acceptance | `pnpm verify:acceptance` | passed | 508 ms |
| sources | `pnpm verify:sources` | passed | 473 ms |
| protocol | `pnpm verify:protocol` | passed | 638 ms |
| infra | `pnpm verify:infra` | passed | 566 ms |
| project-license | `pnpm verify:project-license` | passed | 471 ms |
| licenses | `pnpm verify:licenses` | passed | 640 ms |
| build | `pnpm build` | passed | 25523 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 736 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 33166 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 215756 ms |
