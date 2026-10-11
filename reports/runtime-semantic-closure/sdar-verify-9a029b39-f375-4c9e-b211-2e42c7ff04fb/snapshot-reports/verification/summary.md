# Verification Summary

- Status: **failed**
- Commit: `52f54a11a40380f7c73bd9da277d640e49bdfbf7` (dirty working tree)
- Started: 2026-10-10T14:00:52.707Z
- Finished: 2026-10-10T14:20:30.467Z
- Duration: 1177760 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 39145 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 11830 ms |
| lint | `pnpm lint` | passed | 135085 ms |
| typecheck | `pnpm typecheck` | passed | 46721 ms |
| unit | `pnpm test:unit` | passed | 124422 ms |
| contract | `pnpm test:contract` | passed | 44533 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8155 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 4896 ms |
| architecture | `pnpm verify:architecture` | passed | 9043 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 8473 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 4110 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 9013 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 6218 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 9633 ms |
| acceptance | `pnpm verify:acceptance` | passed | 8628 ms |
| sources | `pnpm verify:sources` | passed | 7625 ms |
| protocol | `pnpm verify:protocol` | passed | 5411 ms |
| infra | `pnpm verify:infra` | passed | 8590 ms |
| project-license | `pnpm verify:project-license` | passed | 4118 ms |
| licenses | `pnpm verify:licenses` | passed | 7996 ms |
| build | `pnpm build` | passed | 45888 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 8628 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 65410 ms |
| postgres-redis-integration | `pnpm test:integration` | passed | 336265 ms |
| postgres-redis-model-mcp-e2e | `pnpm test:e2e` | failed | 217877 ms |
