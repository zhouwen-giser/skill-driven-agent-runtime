# Verification Summary

- Status: **failed**
- Commit: `7b763ae711ae5cab9c8063ab245ee531db5f4a1c` (dirty working tree)
- Started: 2026-10-11T04:55:12.779Z
- Finished: 2026-10-11T05:05:35.663Z
- Duration: 622884 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 40672 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10033 ms |
| lint | `pnpm lint` | passed | 146018 ms |
| typecheck | `pnpm typecheck` | passed | 47995 ms |
| unit | `pnpm test:unit` | passed | 133217 ms |
| contract | `pnpm test:contract` | passed | 44900 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 9497 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 2975 ms |
| architecture | `pnpm verify:architecture` | passed | 8387 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 4086 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 8041 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 4633 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10853 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7735 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4736 ms |
| sources | `pnpm verify:sources` | passed | 7472 ms |
| protocol | `pnpm verify:protocol` | passed | 5235 ms |
| infra | `pnpm verify:infra` | passed | 7704 ms |
| project-license | `pnpm verify:project-license` | passed | 7480 ms |
| licenses | `pnpm verify:licenses` | passed | 5456 ms |
| build | `pnpm build` | passed | 45702 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | failed | 60018 ms |
