# Verification Summary

- Status: **failed**
- Commit: `4112a90bfd11de337db056dc083c4f05bd5360c1` (dirty working tree)
- Started: 2026-10-13T15:58:22.438Z
- Finished: 2026-10-13T16:21:46.026Z
- Duration: 1403588 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 43717 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10356 ms |
| lint | `pnpm lint` | passed | 179764 ms |
| typecheck | `pnpm typecheck` | passed | 54729 ms |
| unit | `pnpm test:unit` | passed | 152090 ms |
| contract | `pnpm test:contract` | passed | 47689 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 8308 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 4333 ms |
| architecture | `pnpm verify:architecture` | passed | 8593 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 4446 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 7589 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7864 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 10975 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7627 ms |
| acceptance | `pnpm verify:acceptance` | passed | 4857 ms |
| sources | `pnpm verify:sources` | passed | 7630 ms |
| protocol | `pnpm verify:protocol` | passed | 5543 ms |
| infra | `pnpm verify:infra` | passed | 7785 ms |
| project-license | `pnpm verify:project-license` | passed | 4642 ms |
| licenses | `pnpm verify:licenses` | passed | 8051 ms |
| build | `pnpm build` | passed | 51698 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 7964 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 97221 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 660075 ms |
