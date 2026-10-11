# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T17:01:19.747Z
- Finished: 2026-10-10T17:17:17.005Z
- Duration: 957258 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 37696 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10056 ms |
| lint | `pnpm lint` | passed | 135187 ms |
| typecheck | `pnpm typecheck` | passed | 45721 ms |
| unit | `pnpm test:unit` | passed | 131032 ms |
| contract | `pnpm test:contract` | passed | 43716 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 9884 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 7494 ms |
| architecture | `pnpm verify:architecture` | passed | 6123 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7421 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7426 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7899 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10913 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 8236 ms |
| acceptance | `pnpm verify:acceptance` | passed | 8224 ms |
| sources | `pnpm verify:sources` | passed | 7416 ms |
| protocol | `pnpm verify:protocol` | passed | 6300 ms |
| infra | `pnpm verify:infra` | passed | 7721 ms |
| project-license | `pnpm verify:project-license` | passed | 7895 ms |
| licenses | `pnpm verify:licenses` | passed | 5078 ms |
| build | `pnpm build` | passed | 45360 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 8324 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 66973 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 325130 ms |
