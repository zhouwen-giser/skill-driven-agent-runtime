# Verification Summary

- Status: **failed**
- Commit: `4112a90bfd11de337db056dc083c4f05bd5360c1` (dirty working tree)
- Started: 2026-10-13T15:29:17.112Z
- Finished: 2026-10-13T15:51:42.090Z
- Duration: 1344978 ms
- Environment: Node v22.23.2, linux/x64
- Infrastructure mode: self-managed-compose

| Gate | Command | Result | Duration |
| --- | --- | --- | ---: |
| format | `pnpm format:check` | passed | 44446 ms |
| verification-runner-contract | `pnpm test:verification` | passed | 10903 ms |
| lint | `pnpm lint` | passed | 160785 ms |
| typecheck | `pnpm typecheck` | passed | 52045 ms |
| unit | `pnpm test:unit` | passed | 157034 ms |
| contract | `pnpm test:contract` | passed | 49552 ms |
| evidence-contract | `pnpm verify:evidence-contract` | passed | 9295 ms |
| evidence-coverage | `pnpm verify:evidence-coverage` | passed | 3614 ms |
| architecture | `pnpm verify:architecture` | passed | 10521 ms |
| a2a-baseline | `pnpm verify:a2a-baseline` | passed | 7576 ms |
| management-openapi | `pnpm verify:management-openapi` | passed | 5378 ms |
| node-control-contract | `pnpm verify:node-control-contract` | passed | 7661 ms |
| node-control-implementation-conformance | `pnpm verify:node-control-implementation-conformance` | passed | 8446 ms |
| smpp-registry-projection | `pnpm verify:smpp-registry-projection` | passed | 7857 ms |
| acceptance | `pnpm verify:acceptance` | passed | 7532 ms |
| sources | `pnpm verify:sources` | passed | 9962 ms |
| protocol | `pnpm verify:protocol` | passed | 7807 ms |
| infra | `pnpm verify:infra` | passed | 7722 ms |
| project-license | `pnpm verify:project-license` | passed | 5395 ms |
| licenses | `pnpm verify:licenses` | passed | 8048 ms |
| build | `pnpm build` | passed | 122383 ms |
| cognitive-replay-no-physical-provider | `pnpm verify:cognitive-replay` | passed | 9333 ms |
| clean-baseline-reset-seed | `pnpm verify:migrations` | passed | 95117 ms |
| postgres-redis-integration | `pnpm test:integration` | failed | 536520 ms |
